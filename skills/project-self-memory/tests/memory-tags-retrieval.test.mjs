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

/**
 * Given：两个候选正文相关性相同，一个带命中标签一个不带
 * When：显式 task.tags 或 query 键值要求该标签
 * Then：标签不改变 rank 排序（规格 L138 冻结）；tag_matches 只覆盖入选记录的只读归因，boost 恒为 0
 * 防回归：标签加权绕过本规格的排序冻结，或 audit 泄漏标签原文
 */
for (const field of ['query', 'goal', 'objective', 'description', 'title', 'task']) {
  test(`tag intent via task.${field} does not change ranking`, () => {
    const result = select([
      record('0001', 'deploy worker', { tags: ['cluster:zephyr'] }),
      record('0002', 'deploy worker', { tags: ['cluster:atlas'] }),
    ], { [field]: 'deploy cluster:atlas' });
    assert.deepEqual(ids(result), ['0001']);
    assert.deepEqual(result.audit.tag_matches, [{ matched: 0, task: 0, query_pair: 0, boost: 0 }]);
  });
}

/**
 * Given：两条正文完全相同的候选，各自命中显式标签
 * When：task.tags 命中任意一条
 * Then：排序保持字典序 ID 平局，标签命中只体现在 audit 归因计数
 * 防回归：把 metadata 当作打破平局的依据
 */
test('tag matches never break a base-relevance tie', () => {
  const result = select([
    record('0001', 'deploy service', { tags: ['env:stage'] }),
    record('0002', 'deploy service', { tags: ['env:prod'] }),
  ], { query: 'deploy', tags: ['env:prod'] });
  assert.deepEqual(ids(result), ['0001']);
  assert.deepEqual(result.audit.tag_matches.map((item) => item.boost), [0]);
});

/**
 * Given：query 明确要求 cluster:atlas 的完整键值
 * When：两条正文均命中 deploy，标签不同
 * Then：键值意图不改变排序；命中计入 query_pair 归因
 * 防回归：query 结构化意图参与 rank
 */
test('query key:value intent is observed but not ranked', () => {
  const result = select([
    record('0001', 'deploy worker', { tags: ['cluster:zephyr'] }),
    record('0002', 'deploy worker', { tags: ['cluster:atlas'] }),
  ], { query: 'deploy cluster:atlas' }, { max_records: 2 });
  assert.deepEqual(ids(result), ['0001', '0002']);
  assert.deepEqual(result.audit.tag_matches.map((item) => item.query_pair), [0, 1]);
  assert.deepEqual(result.audit.tag_matches.map((item) => item.boost), [0, 0]);
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
 * Given：标签和正文含独特敏感字符串，显式任务标签命中
 * When：检查检索 audit 的归因
 * Then：仅输出计数与恒零权重，顺序对应 selected_ids，不泄露任意输入
 * 防回归：为解释命中而把标签原文或正文写入 audit
 */
test('tag audit reports numeric attribution without leaking bodies', () => {
  const result = select([record('0001', 'deploy BODY_SECRET', {
    tags: ['scope:private_secret'], arbitrary: 'ARBITRARY_SECRET',
  })], { query: 'deploy', tags: ['scope:private_secret'] });
  assert.deepEqual(result.audit.tag_matches, [{ matched: 1, task: 1, query_pair: 0, boost: 0 }]);
  assert.doesNotMatch(JSON.stringify(result.audit), /BODY_SECRET|private_secret|ARBITRARY_SECRET|scope:/);
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
 * 防回归：metadata 绕过人工策展状态
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
 * 防回归：标签被误用于质量过滤
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
 * 防回归：标签绕过 token 或记录预算
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
 * Given：显式任务标签与 query 键值同时命中同一条记录
 * When：读取审计归因
 * Then：两类命中分别计数，boost 恒为 0（无叠加、无上限逻辑）
 * 防回归：移除加权后仍残留 boost 计算分支
 */
test('combined structured tag signals stay observational only', () => {
  const result = select([record('0001', 'deploy', { tags: ['env:prod', 'region:east'] })], {
    query: 'deploy env:prod region:east env:prod', tags: ['env:prod', 'region:east'],
  });
  assert.deepEqual(result.audit.tag_matches, [{ matched: 2, task: 2, query_pair: 2, boost: 0 }]);
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
  assert.deepEqual(result.audit.tag_matches, [{ matched: 1, task: 1, query_pair: 0, boost: 0 }]);
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
