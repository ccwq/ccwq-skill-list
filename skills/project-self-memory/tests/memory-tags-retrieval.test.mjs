import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMemoryContext } from '../scripts/memory-retrieval.mjs';

const NOW = Date.parse('2026-09-01T00:00:00Z');
const OPTIONS = { max_records: 1, max_context_tokens: 1000 };
const record = (id, content, extra = {}) => ({
  id, type: 'fact', status: 'active', content,
  confidence: 0.5, utility: 0.5, freshness: 0.5, ...extra,
});
const select = (records, task, options = {}) => selectMemoryContext(records, { ...OPTIONS, ...options }, task, NOW);
const ids = (result) => result.records.map((item) => item.id);

for (const field of ['query', 'goal', 'objective', 'description', 'title', 'task']) {
  /**
   * Given：任务以任一受支持的正文入口明确要求 cluster:atlas，候选正文相关性相同
   * When：通过该字段执行完整键值检索
   * Then：所有入口都优先选择 atlas，且 bonus 与 query 入口相同
   * 防回归：基础相关性支持多个任务字段，但标签加分仅处理 query
   */
  test(`structured tag intent supports task.${field}`, () => {
    const result = select([
      record('0001', 'deploy worker', { tags: ['cluster:zephyr'] }),
      record('0002', 'deploy worker', { tags: ['cluster:atlas'] }),
    ], { [field]: 'deploy cluster:atlas' });
    assert.deepEqual(ids(result), ['0002']);
    assert.deepEqual(result.audit.tag_matches, [{ matched: 1, task: 0, query_pair: 1, boost: 0.015 }]);
  });
}


// 独立人工 gold；每个样例由公开入口单独执行，不从实现计算 expected。
const rankingExamples = [
  /**
   * Given：部署正文相同，显式要求 region:east
   * When：按地区标签检索
   * Then：东区候选优先
   * 防回归：忽略结构化地区
   */
  ['region east', 'rollout', ['region:west'], ['region:east'], { query: 'rollout', tags: ['region:east'] }, ['0002']],
  /**
   * Given：队列正文相同，显式要求 engine:rabbitmq
   * When：按引擎标签检索
   * Then：RabbitMQ 候选优先
   * 防回归：跨引擎混淆
   */
  ['queue engine', 'queue', ['engine:kafka'], ['engine:rabbitmq'], { query: 'queue', tags: ['engine:rabbitmq'] }, ['0002']],
  /**
   * Given：认证正文相同，显式要求 scheme:oidc
   * When：按认证协议检索
   * Then：OIDC 候选优先
   * 防回归：只匹配 scheme 键
   */
  ['auth scheme', 'authentication', ['scheme:saml'], ['scheme:oidc'], { query: 'authentication', tags: ['scheme:oidc'] }, ['0002']],
  /**
   * Given：构建正文相同，显式要求普通标签 vite
   * When：按普通标签检索
   * Then：Vite 候选优先
   * 防回归：只支持带冒号标签
   */
  ['plain build tag', 'build', ['webpack'], ['vite'], { query: 'build', tags: ['vite'] }, ['0002']],
  /**
   * Given：缓存正文相同，任务使用单字符串标签
   * When：按 cache:redis 检索
   * Then：Redis 候选优先
   * 防回归：遗漏旧任务字符串输入
   */
  ['string task tag', 'cache', ['cache:memcached'], ['cache:redis'], { query: 'cache', tags: 'cache:redis' }, ['0002']],
  /**
   * Given：迁移正文相同，query 明确 storage:postgres
   * When：按完整键值检索
   * Then：Postgres 候选优先
   * 防回归：关键词只能在正文出现才生效
   */
  ['query database pair', 'migration', ['storage:mysql'], ['storage:postgres'], { query: 'migration storage:postgres' }, ['0002']],
  /**
   * Given：指标正文相同，query 使用大写完整键值
   * When：按 MONITOR:PROMETHEUS 检索
   * Then：Prometheus 候选优先
   * 防回归：query 大小写导致漏匹配
   */
  ['query case folding', 'metrics', ['monitor:datadog'], ['monitor:prometheus'], { query: 'metrics MONITOR:PROMETHEUS' }, ['0002']],
  /**
   * Given：网络正文相同，query 使用等号形式
   * When：按 network=overlay 检索
   * Then：overlay 候选优先
   * 防回归：等号格式丢失
   */
  ['query network equals', 'networking', ['network:bridge'], ['network:overlay'], { query: 'networking network=overlay' }, ['0002']],
  /**
   * Given：服务正文相同，标签值包含点号
   * When：query 指定 runtime:node.js
   * Then：Node.js 候选优先
   * 防回归：结构化值被普通词项拆散
   */
  ['query dotted value', 'runtime', ['runtime:bun'], ['runtime:node.js'], { query: 'runtime runtime:node.js' }, ['0002']],
  /**
   * Given：发布正文相同，标签值含连字符
   * When：query 指定 channel:canary-east
   * Then：完整连字符值候选优先
   * 防回归：仅匹配值的前缀
   */
  ['query hyphen value', 'release', ['channel:canary-west'], ['channel:canary-east'], { query: 'release channel:canary-east' }, ['0002']],
  /**
   * Given：备份正文相同，task.tags 有两个明确维度
   * When：比较部分匹配与完整匹配
   * Then：两个维度都匹配的候选优先
   * 防回归：只比较第一标签
   */
  ['multiple requested dimensions', 'backup', ['env:prod'], ['env:prod', 'storage:s3'], { query: 'backup', tags: ['env:prod', 'storage:s3'] }, ['0002']],
  /**
   * Given：路由正文相同，正确标签在记录的第二项
   * When：请求 region:north
   * Then：第二项命中仍生效
   * 防回归：只检索首标签
   */
  ['match second record tag', 'routing', ['team:edge', 'region:south'], ['team:edge', 'region:north'], { query: 'routing', tags: ['region:north'] }, ['0002']],
  /**
   * Given：证书正文相同，query 只有通用键 issuer
   * When：比较不同发行者
   * Then：不因共享键额外加分
   * 防回归：标签 key 污染主题排序
   */
  ['generic key ignored', 'certificate', [], ['issuer:acme'], { query: 'certificate issuer' }, ['0001']],
  /**
   * Given：日志正文相同，query 只有常见值 docker
   * When：比较有无组件标签
   * Then：裸值不触发 bonus
   * 防回归：Docker 主题正文被重复计分
   */
  ['generic component ignored', 'logs', [], ['component:docker'], { query: 'logs docker' }, ['0001']],
  /**
   * Given：索引正文相同，query 指定 host:atlas 而非 cluster:atlas
   * When：按键值检索
   * Then：同值异键不命中
   * 防回归：丢弃 key 造成跨维度命中
   */
  ['same value wrong key', 'indexing', [], ['cluster:atlas'], { query: 'indexing host:atlas' }, ['0001']],
  /**
   * Given：扩容正文相同，query 指定 pool:workers-extra
   * When：比较 pool:workers 标签
   * Then：前缀不算精确命中
   * 防回归：结构化值被子串匹配
   */
  ['query value prefix rejected', 'scaling', [], ['pool:workers'], { query: 'scaling pool:workers-extra' }, ['0001']],
  /**
   * Given：事务正文相同，显式标签只要求 engine 而非 engine:innodb
   * When：精确匹配 task.tags
   * Then：不同标签不命中
   * 防回归：结构化标签退化为 key 模糊匹配
   */
  ['explicit key not pair', 'transaction', [], ['engine:innodb'], { query: 'transaction', tags: ['engine'] }, ['0001']],
  /**
   * Given：CDN 正文相同，显式标签要求 zone:edge-extra
   * When：比较 zone:edge
   * Then：任务标签前缀不命中
   * 防回归：显式标签失去精确语义
   */
  ['explicit prefix rejected', 'cdn', [], ['zone:edge'], { query: 'cdn', tags: ['zone:edge-extra'] }, ['0001']],
  /**
   * Given：健康检查正文相同，两条都命中同一个标签但第二条重复多次
   * When：按服务标签检索
   * Then：重复标签不提高排序
   * 防回归：标签计数 spam
   */
  ['duplicates do not improve rank', 'healthcheck', ['service:gateway'], ['service:gateway', 'service:gateway', 'service:gateway'], { query: 'healthcheck', tags: ['service:gateway'] }, ['0001']],
  /**
   * Given：调度正文相同，只有第二条含大量无关标签
   * When：请求不存在的主题
   * Then：标签数量不改变平局排序
   * 防回归：无关标签越多分数越高
   */
  ['unrelated tag spam ignored', 'scheduling', [], ['a:one', 'b:two', 'c:three', 'd:four'], { query: 'scheduling', tags: ['env:prod'] }, ['0001']],
  /**
   * Given：锁正文相同，task.tags 含重复的目标标签
   * When：与单个目标标签结果比较
   * Then：匹配第二条且重复请求不稀释有效意图
   * 防回归：重复请求影响覆盖率
   */
  ['duplicate requested tags', 'locking', ['backend:file'], ['backend:redis'], { query: 'locking', tags: ['backend:redis', 'backend:redis'] }, ['0002']],
  /**
   * Given：连接池正文相同，query 无显式标签语法
   * When：候选标签都不在任务中
   * Then：保留已知的字典序平局结果
   * 防回归：仅存在标签就加分
   */
  ['metadata presence alone ignored', 'pooling', [], ['driver:postgres'], { query: 'pooling' }, ['0001']],
];
for (const [name, body, firstTags, secondTags, task, expected] of rankingExamples) {
  /**
   * Given：上述独立样例的两个合成候选与人工期望 ID
   * When：通过 selectMemoryContext 执行 top-1 检索
   * Then：输出精确符合该样例的字面量期望
   * 防回归：不使用排序实现重新计算测试 gold
   */
  test(`literal ranking: ${name}`, () => {
    assert.deepEqual(ids(select([
      record('0001', body, { tags: firstTags }), record('0002', body, { tags: secondTags }),
    ], task)), expected);
  });
}

/**
 * Given：同等正文相关性，只有第二条匹配明确的 env:prod 任务标签
 * When：通过公开检索入口只选一条
 * Then：精确标签使生产环境记录优先
 * 防回归：显式任务标签被当作普通词项，无法区分生产与测试环境
 */
test('explicit structured task tags break a base-relevance tie', () => {
  const result = select([
    record('0001', 'deploy service', { tags: ['env:stage'] }),
    record('0002', 'deploy service', { tags: ['env:prod'] }),
  ], { query: 'deploy', tags: ['env:prod'] });
  assert.deepEqual(ids(result), ['0002']);
});

/**
 * Given：正文均只命中 deploy，第二条标签为 cluster:atlas
 * When：任务 query 明确要求 cluster:atlas
 * Then：完整键值匹配使第二条优先，且不需要正文重复标签
 * 防回归：派生标签只展示不参与 query 排序
 */
test('query key:value uses a complete structured tag match', () => {
  assert.deepEqual(ids(select([
    record('0001', 'deploy worker', { tags: ['cluster:zephyr'] }),
    record('0002', 'deploy worker', { tags: ['cluster:atlas'] }),
  ], { query: 'deploy cluster:atlas' })), ['0002']);
});

/**
 * Given：query 使用部署前缀习惯的 cluster=atlas，正文仍有 deploy 基础相关性
 * When：检索两个不同集群候选
 * Then：等号形式与标签的完整键值等价
 * 防回归：只能识别冒号，遗漏现有方括号前缀写法
 */
test('query key=value selects the requested cluster', () => {
  assert.deepEqual(ids(select([
    record('0001', 'deploy worker', { tags: ['cluster:zephyr'] }),
    record('0002', 'deploy worker', { tags: ['cluster:atlas'] }),
  ], { query: 'deploy [cluster=atlas]' })), ['0002']);
});

/**
 * Given：任务以独立 atlas 值描述集群，两条正文同样命中 deploy
 * When：没有结构化键值或显式 task.tags 的自由文本检索
 * Then：裸值不额外加分，保留正文排序
 * 防回归：主题词已经计入正文，标签再次计分挤占正确记录
 */
test('query bare value does not double count the topic', () => {
  assert.deepEqual(ids(select([
    record('0001', 'deploy worker', { tags: ['cluster:zephyr'] }),
    record('0002', 'deploy worker', { tags: ['cluster:atlas'] }),
  ], 'deploy atlas')), ['0001']);
});

/**
 * Given：记录带有合法标签以及不允许外泄的任意额外字段
 * When：检索并读取 safeRecord 输出
 * Then：标签得到独立的只读投影，额外字段不透传且上下文正文格式不变
 * 防回归：标签在检索边界丢失或可被调用者修改原始数组
 */
test('selected safe records preserve optional tags without leaking other fields', () => {
  const input = record('0001', 'deploy worker', { tags: ['env:prod', 'release'], secret: 'PRIVATE' });
  const result = select([input], { query: 'deploy' });
  assert.deepEqual(result.records[0].tags, ['env:prod', 'release']);
  assert.notEqual(result.records[0].tags, input.tags);
  assert.ok(Object.isFrozen(result.records[0].tags));
  assert.equal(result.records[0].secret, undefined);
  assert.equal(result.memoryContext, '[0001][事实] deploy worker');
});

/**
 * Given：标签和正文含独特敏感字符串，显式任务标签触发一次加分
 * When：检查检索 audit 的归因
 * Then：仅输出计数与数值权重，顺序对应 selected_ids，不泄露任意输入
 * 防回归：为解释命中而把标签原文或正文写入 audit
 */
test('tag audit reports numeric match and boost attribution only', () => {
  const result = select([record('0001', 'deploy BODY_SECRET', {
    tags: ['scope:private_secret'], arbitrary: 'ARBITRARY_SECRET',
  })], { query: 'deploy', tags: ['scope:private_secret'] });
  assert.deepEqual(result.audit.tag_matches, [{ matched: 1, task: 1, query_pair: 0, boost: 0.03 }]);
  assert.doesNotMatch(JSON.stringify(result.audit), /BODY_SECRET|private_secret|ARBITRARY_SECRET|scope:/);
});

/**
 * Given：deploy 相关候选的标签值分别为 false 和 true，任务只有通用 true
 * When：使用自由文本检索
 * Then：通用值不能让第二条加分，保留已知 ID 顺序
 * 防回归：布尔值等非主题词制造广泛的虚假命中
 */
test('generic query values do not boost unrelated topics', () => {
  const result = select([
    record('0001', 'deploy worker', { tags: ['enabled:false'] }),
    record('0002', 'deploy worker', { tags: ['enabled:true'] }),
  ], { query: 'deploy true' });
  assert.deepEqual(ids(result), ['0001']);
  assert.equal(result.audit.tag_matches[0].boost, 0);
});

/**
 * Given：第一条命中 deploy restart，第二条只命中 deploy 但标签完全匹配
 * When：十个查询词加显式环境标签进行检索
 * Then：较强的正文依据仍优先于标签，标签不掩盖实质相关性差距
 * 防回归：过大的 metadata 权重将弱正文候选挤入预算
 */
test('tag bonus does not overturn a meaningful base relevance lead', () => {
  assert.deepEqual(ids(select([
    record('0001', 'deploy restart'),
    record('0002', 'deploy', { tags: ['env:prod'] }),
  ], { query: 'deploy restart rollout health logs image registry probe timeout failure', tags: ['env:prod'] })), ['0001']);
});

/**
 * Given：正文相同但一条具有 kubernetes 普通主题标签
 * When：query 以独立词项 kubernetes 指明主题
 * Then：普通词项不额外加分，只有显式 task.tags 才表示精确标签意图
 * 防回归：通用主题匹配造成正文和标签重复计分
 */
test('query bare plain tag does not imply explicit tag intent', () => {
  assert.deepEqual(ids(select([
    record('0001', 'deploy worker', { tags: ['nomad'] }),
    record('0002', 'deploy worker', { tags: ['kubernetes'] }),
  ], { query: 'deploy kubernetes' })), ['0001']);
});

/**
 * Given：一条无正文关联但标签全匹配的高分记录，以及一条正文相关记录
 * When：分别通过显式标签、query 键值和仅标签任务检索
 * Then：标签不能让零基础相关性候选入围
 * 防回归：将 metadata 算入基础门槛，绕过零相关过滤
 */
test('tag-only evidence never admits a zero base relevance record', () => {
  const records = [
    record('0001', 'unrelated secret', { confidence: 1, utility: 1, freshness: 1, tags: ['env:prod'] }),
    record('0002', 'deploy service'),
  ];
  assert.deepEqual(ids(select(records, { query: 'deploy', tags: ['env:prod'] })), ['0002']);
  assert.deepEqual(ids(select(records, { query: 'deploy env:prod' })), ['0002']);
  const onlyTags = select([records[0]], { tags: ['env:prod'] });
  assert.deepEqual(ids(onlyTags), []);
  assert.equal(onlyTags.audit.excluded['low-relevance'], 1);
});

/**
 * Given：review 和 disabled 记录完全匹配标签且拥有高分
 * When：选择同主题 active 记录
 * Then：仅 active 被选中，原状态审计计数不变
 * 防回归：metadata 加分绕过人工策展状态
 */
test('tags cannot revive review or disabled memories', () => {
  const result = select([
    record('0001', 'deploy', { status: 'review', tags: ['env:prod'] }),
    record('0002', 'deploy', { status: 'disabled', tags: ['env:prod'] }),
    record('0003', 'deploy'),
  ], { query: 'deploy', tags: ['env:prod'] }, { max_records: 3 });
  assert.deepEqual(ids(result), ['0003']);
  assert.equal(result.audit.excluded['status-review'], 1);
  assert.equal(result.audit.excluded['status-disabled'], 1);
});

/**
 * Given：标签命中但可信度、效用或新鲜度低于独立门槛
 * When：请求高质量部署上下文
 * Then：三种质量门槛均保持有效
 * 防回归：标签 boost 被误用于质量过滤
 */
test('tag matches do not bypass confidence utility or freshness gates', () => {
  const result = select([
    record('0001', 'deploy', { confidence: 0, tags: ['env:prod'] }),
    record('0002', 'deploy', { utility: 0, tags: ['env:prod'] }),
    record('0003', 'deploy', { freshness: 0, tags: ['env:prod'] }),
    record('0004', 'deploy'),
  ], { query: 'deploy', tags: ['env:prod'] }, { min_confidence: 0.2, min_utility: 0.2, min_freshness: 0.2 });
  assert.deepEqual(ids(result), ['0004']);
  assert.deepEqual(result.audit.excluded, { 'low-confidence': 1, 'low-utility': 1, stale: 1 });
});

/**
 * Given：标签命中的短正文先入选，后续长正文不能装入剩余预算
 * When：仅允许 8 tokens 与最多两条记录
 * Then：只选择短正文，实际估算为 6 tokens
 * 防回归：标签优先级绕过 token 或记录预算
 */
test('tag matches obey literal token and record budgets', () => {
  const result = select([
    record('0001', 'deploy', { tags: ['env:prod'] }),
    record('0002', `deploy ${'x'.repeat(100)}`, { tags: ['env:prod'] }),
  ], { query: 'deploy', tags: ['env:prod'] }, { max_context_tokens: 8, max_records: 2 });
  assert.deepEqual(ids(result), ['0001']);
  assert.equal(result.audit.estimated_tokens, 6);
  assert.equal(result.audit.excluded.budget, 1);
});

/**
 * Given：两个旧 group 各有相关候选，标签全部相同
 * When：有无标签各检索两条
 * Then：group 多样性仍覆盖 ops 和 docs，标签不替换 group
 * 防回归：标签分桶无意改变已有组多样性
 */
test('legacy group diversity remains unchanged when tags are present but not requested', () => {
  const records = [record('0001', 'deploy', { group: 'ops' }), record('0002', 'deploy', { group: 'ops' }), record('0003', 'deploy', { group: 'docs' })];
  const plain = select(records, { query: 'deploy' }, { max_records: 2 });
  const tagged = select(records.map((item) => ({ ...item, tags: ['env:prod'] })), { query: 'deploy' }, { max_records: 2 });
  assert.deepEqual(ids(plain), ['0001', '0003']);
  assert.deepEqual(ids(tagged), ['0001', '0003']);
  assert.deepEqual(tagged.audit.diversity, plain.audit.diversity);
});

/**
 * Given：三个无标签候选加一个有标签候选均无 group
 * When：max_records 足够容纳四条
 * Then：全部入选，不给无标签候选新增 diversity-cap
 * 防回归：新标签桶让原来的 ungrouped 共享组被不公平截断
 */
test('untagged records are never squeezed out by optional topic buckets', () => {
  const result = select([
    record('0001', 'deploy'), record('0002', 'deploy'), record('0003', 'deploy'),
    record('0004', 'deploy', { tags: ['env:prod'] }),
  ], { query: 'deploy' }, { max_records: 4 });
  assert.deepEqual(ids(result), ['0001', '0002', '0003', '0004']);
  assert.deepEqual(result.audit.diversity, { groups: 1, max_per_group: 4 });
  assert.equal(result.audit.excluded['diversity-cap'], undefined);
});

/**
 * Given：显式任务标签全部命中，query 同时包含相同完整键值
 * When：请求单条标签丰富的记录
 * Then：审计命中去重，两个归因可见，总 boost 不超过 0.04
 * 防回归：重复 query、多个标签或双重归因无限叠加
 */
test('combined structured tag signals have a literal four-point ceiling', () => {
  const result = select([record('0001', 'deploy', { tags: ['env:prod', 'region:east'] })], {
    query: 'deploy env:prod region:east env:prod', tags: ['env:prod', 'region:east'],
  });
  assert.deepEqual(result.audit.tag_matches, [{ matched: 2, task: 2, query_pair: 2, boost: 0.04 }]);
});

/**
 * Given：标签匹配和未匹配记录同为候选，但没有正文任务上下文
 * When：任务为空或 all 模式下无关检索
 * Then：空任务不凭标签猜测意图；all 仍遵守旧的全候选语义
 * 防回归：可选标签改变空任务默认加载方式
 */
test('empty task and all mode keep existing eligibility semantics', () => {
  const records = [record('0001', 'unrelated'), record('0002', 'unrelated', { tags: ['env:prod'] })];
  assert.deepEqual(ids(select(records, {})), ['0001']);
  const result = select(records, { query: 'deploy', tags: ['env:prod'] }, { load_mode: 'all', max_records: 2 });
  assert.deepEqual(ids(result), ['0001', '0002']);
  assert.deepEqual(result.audit.tag_matches.map((item) => item.boost), [0, 0]);
});

/**
 * Given：off 策略与含敏感标签的候选
 * When：关闭自动上下文加载
 * Then：空输出且 audit 不包含标签或正文
 * 防回归：标签计算绕过 off 策略
 */
test('off mode returns no tag or body material', () => {
  const result = select([record('0001', 'PRIVATE_BODY', { tags: ['scope:private'] })], { tags: ['scope:private'] }, { load_mode: 'off' });
  assert.deepEqual(ids(result), []);
  assert.equal(result.memoryContext, '');
  assert.doesNotMatch(JSON.stringify(result.audit), /PRIVATE_BODY|scope:private/);
});

/**
 * Given：标签包含非字符串值与非法文本，另外有一个合法字符串标签
 * When：检索并投影安全记录
 * Then：忽略无效 metadata，不报错、不泄露任意输入
 * 防回归：可选分类数据损坏阻塞检索
 */
test('invalid optional tag values degrade to valid string metadata only', () => {
  const result = select([record('0001', 'deploy', { tags: [null, 123, {}, 'BAD TAG', 'env:prod'] })], { query: 'deploy', tags: ['env:prod', null] });
  assert.deepEqual(result.records[0].tags, ['env:prod']);
  assert.equal(result.audit.tag_matches[0].boost, 0.03);
  const legacy = select([record('0001', 'deploy')], { query: 'deploy' });
  const malformed = select([record('0001', 'deploy', { tags: { arbitrary: 'PRIVATE' } })], { query: 'deploy' });
  assert.deepEqual(malformed, legacy);
});

/**
 * Given：两个无标签、同分的合成候选，任务仅命中 deploy
 * When：比较缺失 tags 与空 tags 的完整选择结果
 * Then：记录、上下文及 audit 完全一致，并匹配已知的旧版输出
 * 防回归：未配置分类的项目出现字段、排序或审计漂移
 */
test('no tags keeps the literal legacy selection and body-free audit', () => {
  const records = [record('0002', 'deploy beta'), record('0001', 'deploy alpha')];
  const result = select(records, { query: 'deploy' });
  assert.deepEqual(result, select(records.map((item) => ({ ...item, tags: [] })), { query: 'deploy' }));
  assert.deepEqual(ids(result), ['0001']);
  assert.equal(result.memoryContext, '[0001][事实] deploy alpha');
  assert.deepEqual(result.audit, {
    strategy_version: 'retrieval-v1', mode: 'relevant', candidate_count: 2,
    eligible_count: 2, selected_count: 1, estimated_tokens: 8,
    max_context_tokens: 1000, max_records: 1,
    excluded: { budget: 1 },
    excluded_reason_counts: { budget: 1 },
    diversity: { groups: 1, max_per_group: 1 }, selected_ids: ['0001'],
  });
});
