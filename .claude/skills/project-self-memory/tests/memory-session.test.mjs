import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemorySession } from '../scripts/memory-session.mjs';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/memory.mjs');
const run = (root, ...argv) => execFileSync(process.execPath, [cli, '--project-root', root, ...argv], { encoding: 'utf8' });
const tempRoots = new Set();
const temp = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-runtime-'));
  tempRoots.add(root);
  return root;
};
afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.clear();
});
const memory = (root) => path.join(root, '.project-self-memory', 'memory.md');
const config = (root) => path.join(root, '.project-self-memory', 'config.yaml');

function init(root, values = {}) {
  run(root, 'init');
  const lines = fs.readFileSync(config(root), 'utf8').split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
    if (index >= 0) lines[index] = `${key}: ${value}`;
    else lines.push(`${key}: ${value}`);
  }
  fs.writeFileSync(config(root), lines.join('\n'));
}

function addRecord(root, content) {
  const body = path.join(root, 'candidate.txt');
  fs.writeFileSync(body, content);
  run(root, 'add', '--type', 'fact', '--content-file', body);
}

function snapshot(root) {
  return fs.readFileSync(memory(root));
}

function fakeAgent() {
  const calls = [];
  return {
    calls,
    async run(context, tools) {
      calls.push({ context, tools });
      return { conclusion: { type: 'fact', content: 'runtime 新结论' }, evidence: [{ recordId: '0001', positive: true }] };
    },
  };
}

function auditLog() {
  const events = [];
  return { events, emit: (event) => events.push(event) };
}

function spyRunner(root, calls, { fail } = {}) {
  return ({ args, input }) => {
    calls.push({ args: [...args], input });
    if (fail?.(args)) throw new Error('模拟 CLI 失败');
    return {
      stdout: execFileSync(process.execPath, [cli, ...args, '--project-root', root], { encoding: 'utf8', input }),
      stderr: '',
      status: 0,
    };
  };
}

/**
 * Given：同一 active 记录与稳定 task_id，两个独立 MemorySession 提交同一结构化结果
 * When：分别重放相同 record_version/kind/source 的自动证据
 * Then：ledger 只保留一个稳定事件，派生 positive 只增加一次
 * 防回归：宿主重启或任务重试造成自动评分重复累加
 */
test('structured automatic evidence is idempotent across sessions', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'false', auto_rate: 'true' });
  addRecord(root, 'CROSS_SESSION_EVIDENCE_SENTINEL_71a2');
  for (let index = 0; index < 2; index += 1) {
    const session = new MemorySession({ projectRoot: root, agent: null });
    await session.beginTask({ task_id: 'stable-task-71a2', query: 'CROSS_SESSION_EVIDENCE_SENTINEL' });
    const loaded = session.loadedRecords.get('0001');
    assert.equal(session.recordEvidence({
      recordId: '0001', record_version: loaded.record_version, task_id: 'stable-task-71a2',
      kind: 'applied_success', source: 'automatic', direct_causal: true, event_id: 'stable-event-71a2',
    }), true);
    await session.endTask();
  }
  const record = JSON.parse(run(root, 'inspect', '0001'));
  const events = JSON.parse(run(root, 'evidence', 'inspect')).events;
  assert.equal(record.positive, 1);
  assert.equal(events.filter((event) => event.event_id === 'stable-event-71a2').length, 1);
});

/**
 * Given：MemorySession 已经绑定当前 task_id，输入 evidence 伪造另一个 task_id
 * When：提交带不匹配 task_id 的自动证据
 * Then：证据被拒绝，且不会写入 evidence ledger
 * 防回归：调用方通过任意 provenance 冒充另一任务的结果并获得评分
 */
test('evidence must use the current session task id', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'false', auto_rate: 'true' });
  addRecord(root, 'FORGED_TASK_ID_SENTINEL_9c31');
  const session = new MemorySession({ projectRoot: root, agent: null });
  await session.beginTask({ task_id: 'current-task-9c31', query: 'FORGED_TASK_ID_SENTINEL' });
  const loaded = session.loadedRecords.get('0001');

  assert.equal(session.recordEvidence({
    recordId: '0001', record_version: loaded.record_version, task_id: 'forged-task-9c31',
    kind: 'applied_success', source: 'automatic', direct_result: { adopted: true },
  }), false);
  await session.endTask();
  assert.deepEqual(JSON.parse(run(root, 'evidence', 'inspect')).events, []);
});

/**
 * Given：自动 evidence 只有 applied_success/still_valid 声明，没有 host 直接结果
 * When：提交该 evidence 并结束任务
 * Then：事件最多降级为 review_candidate，不产生 positive 派生分
 * 防回归：Agent 自述“已成功/仍有效”绕过 host-confirmed 结果门槛
 */
test('automatic positive evidence without direct host outcome cannot score', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'false', auto_rate: 'true' });
  addRecord(root, 'NO_DIRECT_RESULT_SENTINEL_4e22');
  const session = new MemorySession({ projectRoot: root, agent: null });
  await session.beginTask({ task_id: 'no-direct-task-4e22', query: 'NO_DIRECT_RESULT_SENTINEL' });
  const loaded = session.loadedRecords.get('0001');
  assert.equal(session.recordEvidence({
    recordId: '0001', record_version: loaded.record_version, task_id: 'no-direct-task-4e22',
    kind: 'still_valid', source: 'automatic', host_confirmed: true,
  }), true);
  await session.endTask();
  const record = JSON.parse(run(root, 'inspect', '0001'));
  const event = JSON.parse(run(root, 'evidence', 'inspect')).events[0];
  assert.equal(record.positive, 0);
  assert.equal(event.kind, 'review_candidate');
});

/**
 * Given：Agent 返回 evidence 自述 applied_success，但 host 没有显式确认结果
 * When：仅用 Agent 的 endTask 结果结束任务
 * Then：Agent 自述不会进入 ledger 或增加 positive
 * 防回归：模型输出的 host_confirmed/直接结果字段被错误信任
 */
test('agent self-reported evidence cannot auto-rate', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'false', auto_rate: 'true' });
  addRecord(root, 'AGENT_SELF_REPORT_SENTINEL_5d44');
  const agent = {
    async run() {
      return { evidence: [{
        recordId: '0001', kind: 'applied_success', source: 'automatic',
        direct_result: { adopted: true },
      }] };
    },
  };
  const session = new MemorySession({ projectRoot: root, agent });
  await session.beginTask({ task_id: 'agent-self-report-5d44', query: 'AGENT_SELF_REPORT_SENTINEL' });
  await session.endTask();
  assert.deepEqual(JSON.parse(run(root, 'evidence', 'inspect')).events, []);
});

/**
 * Given：自动结果声明 applied_failure，但没有直接因果证明
 * When：MemorySession 记录该结构化证据
 * Then：事件降级为 review_candidate，不产生 negative 派生分
 * 防回归：无法归因的失败被自动扣分，造成长期悲观偏差
 */
test('unattributed automatic failures become review candidates', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'false', auto_rate: 'true' });
  addRecord(root, 'UNATTRIBUTED_FAILURE_SENTINEL_2d8c');
  const session = new MemorySession({ projectRoot: root, agent: null });
  await session.beginTask({ task_id: 'failure-task-2d8c', query: 'UNATTRIBUTED_FAILURE_SENTINEL' });
  const loaded = session.loadedRecords.get('0001');
  assert.equal(session.recordEvidence({ recordId: '0001', record_version: loaded.record_version,
    task_id: 'failure-task-2d8c', kind: 'applied_failure', source: 'automatic' }), true);
  await session.endTask();
  const record = JSON.parse(run(root, 'inspect', '0001'));
  const event = JSON.parse(run(root, 'evidence', 'inspect')).events[0];
  assert.equal(record.negative, 0);
  assert.equal(event.kind, 'review_candidate');
});

/**
 * Given：配置包含非法 retrieval 值或 all 模式但没有 maintenance 用途
 * When：MemorySession 解析策略并开始任务
 * Then：两种情况都 fail-closed，不加载 memory
 * 防回归：新增检索配置缺失/越权时静默采用危险策略
 */
test('retrieval configuration invalidity and all-mode usage fail closed', async () => {
  for (const value of ['maybe', 'all']) {
    const root = temp();
    init(root);
    addRecord(root, `RETRIEVAL_CONFIG_SENTINEL_${value}`);
    const raw = fs.readFileSync(config(root), 'utf8').replace(/^load_mode: relevant$/m, `load_mode: ${value}`);
    fs.writeFileSync(config(root), raw);
    const session = new MemorySession({ projectRoot: root, agent: null });
    await session.beginTask(value === 'all' ? { query: 'sentinel' } : {});
    assert.equal(session.policy.failClosed, true, value);
  }
  const root = temp(); init(root); addRecord(root, 'MAINTENANCE_ALL_SENTINEL_92fe');
  fs.writeFileSync(config(root), fs.readFileSync(config(root), 'utf8').replace(/^load_mode: relevant$/m, 'load_mode: all'));
  const session = new MemorySession({ projectRoot: root, agent: null });
  await session.beginTask({ maintenance: true, query: 'MAINTENANCE_ALL_SENTINEL' });
  assert.equal(session.policy.failClosed, false);
  assert.equal(session.policy.retrieval.load_mode, 'all');
});

/**
 * Given：真实临时 memory 库含有只应被禁用策略隔离的唯一 sentinel
 * When：以 auto_load=false 启动 MemorySession，并让 fake Agent 捕获 host payload
 * Then：context 不含 sentinel，且没有读取动作与持久化变化
 * 防回归：false 只作为提示词而未真正阻断 memory 文本进入 Agent 上下文
 */
test('auto_load=false is fail-closed and keeps sentinel out of context', async () => {
  const root = temp();
  init(root, { auto_load: 'false', auto_save: 'false', auto_rate: 'false' });
  addRecord(root, 'DISABLED_LOAD_SENTINEL_9f2a');
  const before = snapshot(root);
  const agent = fakeAgent();
  const audit = auditLog();
  const cliCalls = [];
  const session = new MemorySession({ projectRoot: root, agent, audit, runCli: spyRunner(root, cliCalls) });

  await session.beginTask();
  await session.endTask();

  assert.equal(agent.calls.length, 1);
  assert.deepEqual(agent.calls[0].context.memory, []);
  assert.doesNotMatch(JSON.stringify(agent.calls[0].context), /DISABLED_LOAD_SENTINEL_9f2a/);
  assert.deepEqual(snapshot(root), before);
  assert.equal(cliCalls.some(({ args }) => args[0] === 'read'), false);
  assert.ok(audit.events.some((event) => event.action === 'load' && event.outcome === 'blocked'));
  assert.ok(audit.events.some((event) => event.action === 'save' && event.outcome === 'blocked'));
  assert.ok(audit.events.some((event) => event.action === 'rate' && event.outcome === 'blocked'));
  assert.doesNotMatch(JSON.stringify(audit.events), /DISABLED_LOAD_SENTINEL_9f2a/);
});

/**
 * Given：auto_load/save/rate 全部开启，且 active 库含有唯一 sentinel
 * When：完成一次合格结论并重复提交同一 positive evidence
 * Then：Agent 能看到 sentinel，新增结论只写入一次，既有记录最多正向评分一次
 * 防回归：重复 endTask 或重复证据导致分数膨胀或重复 durable add
 */
test('enabled lifecycle loads, saves once, and deduplicates positive rating', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'true', auto_rate: 'true' });
  addRecord(root, 'ENABLED_LOAD_SENTINEL_7b31');
  const agent = fakeAgent();
  const audit = auditLog();
  const session = new MemorySession({ projectRoot: root, agent, audit });

  await session.beginTask();
  const loaded = session.loadedRecords.get('0001');
  await session.recordEvidence({ recordId: '0001', record_version: loaded.record_version,
    kind: 'applied_success', source: 'automatic', host_confirmed: true,
    direct_result: { adopted: true }, event_id: 'enabled-event-7b31' });
  await session.recordEvidence({ recordId: '0001', record_version: loaded.record_version,
    kind: 'applied_success', source: 'automatic', host_confirmed: true,
    direct_result: { adopted: true }, event_id: 'enabled-event-7b31' });
  await session.endTask({ conclusions: [{ type: 'fact', content: 'runtime 新结论', verified: true, isNew: true, conflictFree: true }] });
  const after = snapshot(root).toString();

  assert.match(JSON.stringify(agent.calls[0].context), /ENABLED_LOAD_SENTINEL_7b31/);
  assert.equal((after.match(/runtime 新结论/g) || []).length, 1);
  assert.equal((after.match(/id="0001"[^>]*positive="1"/g) || []).length, 1);
  assert.equal(audit.events.filter((event) => event.action === 'rate' && event.outcome === 'allowed').length, 1);
});

/**
 * Given：配置开启，但 session 与 task override 依次关闭不同能力
 * When：分别创建 session 并在 beginTask 时提供覆盖
 * Then：task 优先于 session，session 优先于 config，且最终策略可审计
 * 防回归：覆盖层级反转导致禁用策略被配置值重新开启
 */
test('policy precedence is task, then session, then config', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'true', auto_rate: 'true' });
  const audit = auditLog();
  const agent = fakeAgent();
  const session = new MemorySession({
    projectRoot: root,
    agent,
    audit,
    policy: { auto_load: false, auto_save: true, auto_rate: true },
  });
  await session.beginTask({ policy: { auto_load: true, auto_save: false } });
  await session.endTask({ conclusions: [{ type: 'fact', content: '不应自动保存' }] });

  assert.equal(session.policy.auto_load, true);
  assert.equal(session.policy.auto_save, false);
  assert.equal(session.policy.auto_rate, true);
  assert.ok(audit.events.some((event) => event.action === 'save' && event.outcome === 'blocked'));
});

/**
 * Given：memory 自动能力已启用，但 Agent 尝试直接访问文件系统和 memory CLI
 * When：通过 host 提供的 task capability layer 发起 bypass 请求
 * Then：两种请求均被拒绝，且拒绝事件不暴露 memory body
 * 防回归：Agent 绕过 MemorySession 直接读写或评分
 */
test('task capabilities reject direct store and memory CLI access', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'true', auto_rate: 'true' });
  addRecord(root, 'CAPABILITY_SENTINEL_3e44');
  const audit = auditLog();
  const agent = fakeAgent();
  const session = new MemorySession({ projectRoot: root, agent, audit });
  await session.beginTask();

  assert.equal(typeof agent.calls[0].tools.readMemory, 'undefined');
  assert.equal(typeof agent.calls[0].tools.writeMemory, 'undefined');
  assert.equal(typeof agent.calls[0].tools.scoreMemory, 'undefined');
  await assert.rejects(() => session.invokeTool('readMemory'), /拒绝|禁止|unavailable/i);
  await assert.rejects(() => session.invokeTool('writeMemory'), /拒绝|禁止|unavailable/i);
  assert.doesNotMatch(JSON.stringify(audit.events), /CAPABILITY_SENTINEL_3e44/);
});

/**
 * Given：配置或 active store 不安全
 * When：启动 MemorySession
 * Then：解析失败进入 fail-closed，context 为空且不发生 durable mutation
 * 防回归：损坏配置/存储被当成开启状态继续读写或评分
 */
test('invalid configuration or unsafe store resolves all automation disabled', async () => {
  const root = temp();
  init(root, { auto_load: 'maybe', auto_save: 'true', auto_rate: 'true' });
  addRecord(root, 'FAIL_CLOSED_SENTINEL_a812');
  fs.writeFileSync(config(root), 'version: 1\nauto_load: maybe\nauto_save: true\nauto_rate: true\n');
  const before = snapshot(root);
  const agent = fakeAgent();
  const audit = auditLog();
  const session = new MemorySession({ projectRoot: root, agent, audit });

  await session.beginTask();
  await session.endTask({ conclusions: [{ type: 'fact', content: '不应写入' }] });

  assert.deepEqual(agent.calls[0].context.memory, []);
  assert.deepEqual(snapshot(root), before);
  assert.ok(audit.events.some((event) => event.action === 'policy-resolution-failure' && event.outcome === 'failed'));
  assert.doesNotMatch(JSON.stringify(audit.events), /FAIL_CLOSED_SENTINEL_a812/);
});

/**
 * Given：配置文件分别缺失、含非法值、重复键或错误版本，且 auto_load 可能写成 false
 * When：MemorySession 解析策略并尝试开始任务
 * Then：所有情形均 fail-closed，不读取 sentinel、不保存、不评分
 * 防回归：某一个配置错误被宽松解析后重新开启自动能力
 */
test('missing, invalid, duplicate, and unsupported config fail closed', async () => {
  const cases = [
    ['missing', undefined],
    ['invalid-value', 'version: 1\nauto_load: maybe\nauto_save: true\nauto_rate: true\n'],
    ['duplicate-key', 'version: 1\nauto_load: false\nauto_load: true\nauto_save: true\nauto_rate: true\n'],
    ['unsupported-version', 'version: 99\nauto_load: false\nauto_save: true\nauto_rate: true\n'],
  ];
  for (const [name, raw] of cases) {
    const root = temp();
    init(root);
    addRecord(root, `CONFIG_FAIL_CLOSED_${name}_d31e`);
    if (raw === undefined) fs.rmSync(config(root));
    else fs.writeFileSync(config(root), raw);
    const before = snapshot(root);
    const agent = fakeAgent();
    const audit = auditLog();
    const calls = [];
    const session = new MemorySession({ projectRoot: root, agent, audit, runCli: spyRunner(root, calls) });

    await session.beginTask();
    await session.endTask({ conclusions: [{ type: 'fact', content: `不应写入-${name}`, verified: true, isNew: true, conflictFree: true }] });

    assert.equal(session.policy.failClosed, true, name);
    assert.deepEqual(agent.calls[0].context.memory, [], name);
    assert.equal(calls.some(({ args }) => args[0] === 'read'), false, name);
    assert.deepEqual(snapshot(root), before, name);
    assert.ok(audit.events.some((event) => event.action === 'policy-resolution-failure' && event.outcome === 'failed'), name);
  }
});

/**
 * Given：配置有效且允许 load，但 active memory 的 read CLI 发生错误
 * When：开始 MemorySession
 * Then：上下文为空、memoryContext 能力为 false，且 load 审计为 blocked
 * 防回归：读取异常后仍把 memoryContext=true 暴露给 Agent，形成不可用能力假象
 */
test('read failure removes memoryContext capability and fails closed', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'true', auto_rate: 'true' });
  const agent = fakeAgent();
  const audit = auditLog();
  const calls = [];
  const session = new MemorySession({
    projectRoot: root,
    agent,
    audit,
    runCli: spyRunner(root, calls, { fail: (args) => args[0] === 'read' }),
  });

  const payload = await session.beginTask();

  assert.deepEqual(payload.memory, []);
  assert.equal(payload.capabilities.memoryContext, false);
  assert.equal(agent.calls[0].tools.capabilities.memoryContext, false);
  assert.ok(audit.events.some((event) => event.action === 'load' && event.outcome === 'blocked'));
});

/**
 * Given：四个候选结论分别缺少 verified/isNew/conflictFree 或显式为 false
 * When：auto_save=true 结束任务
 * Then：没有任何候选被提交给 add CLI，memory 内容保持不变
 * 防回归：缺少安全证明字段被错误当成 true，导致自动写入未经验证结论
 */
test('automatic save requires verified, isNew, and conflictFree to be true', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'true', auto_rate: 'false' });
  const before = snapshot(root);
  const calls = [];
  const session = new MemorySession({ projectRoot: root, agent: fakeAgent(), runCli: spyRunner(root, calls) });
  await session.beginTask();
  await session.endTask({ candidates: [
    { type: 'fact', content: '缺 verified', isNew: true, conflictFree: true },
    { type: 'fact', content: '缺 isNew', verified: true, conflictFree: true },
    { type: 'fact', content: '缺 conflictFree', verified: true, isNew: true },
    { type: 'fact', content: '显式 false', verified: false, isNew: false, conflictFree: false },
  ] });

  assert.equal(calls.filter(({ args }) => args[0] === 'add').length, 0);
  assert.deepEqual(snapshot(root), before);
});

/**
 * Given：Agent 自行返回具备 verified/isNew/conflictFree 的 conclusion
 * When：host 未在 endTask 中显式传入候选结论
 * Then：不会调用 add，memory 内容保持不变
 * 防回归：Agent 自报“已验证的新结论”被错误提升为 host-confirmed 自动保存
 */
test('agent self-supplied conclusion cannot trigger automatic save', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'true', auto_rate: 'false' });
  const before = snapshot(root);
  const calls = [];
  const agent = {
    async run() {
      return { conclusion: {
        type: 'fact', content: 'Agent 自报结论', verified: true, isNew: true, conflictFree: true,
      } };
    },
  };
  const session = new MemorySession({ projectRoot: root, agent, runCli: spyRunner(root, calls) });

  await session.beginTask();
  await session.endTask();

  assert.equal(calls.filter(({ args }) => args[0] === 'add').length, 0);
  assert.deepEqual(snapshot(root), before);
});

/**
 * Given：save 或 rate 的 CLI 在实际动作中失败
 * When：结束任务并触发自动保存/评分
 * Then：对应审计不会误报为完整 allowed；失败原因和部分结果可区分
 * 防回归：失败动作先记录 blocked，随后无条件追加 allowed 掩盖真实失败
 */
test('partial save and rate failures are not reported as fully allowed', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'true', auto_rate: 'true' });
  addRecord(root, 'PARTIAL_FAILURE_SENTINEL_c904');
  const audit = auditLog();
  const calls = [];
  const session = new MemorySession({
    projectRoot: root,
    agent: fakeAgent(),
    audit,
    runCli: spyRunner(root, calls, { fail: (args) => args[0] === 'add' || args[0] === 'score' || args[0] === 'evidence' }),
  });
  await session.beginTask();
  const loaded = session.loadedRecords.get('0001');
  await session.recordEvidence({ recordId: '0001', record_version: loaded.record_version,
    kind: 'applied_success', source: 'automatic', host_confirmed: true,
    direct_result: { adopted: true }, event_id: 'partial-event-c904' });
  await session.endTask({ candidates: [{ type: 'fact', content: '会失败', verified: true, isNew: true, conflictFree: true }] });

  const saveEvents = audit.events.filter((event) => event.action === 'save');
  const rateEvents = audit.events.filter((event) => event.action === 'rate');
  assert.ok(saveEvents.some((event) => event.outcome === 'blocked' && event.reason === 'store-write-failure'));
  assert.ok(rateEvents.some((event) => event.outcome === 'blocked' && event.reason === 'store-score-failure'));
  assert.equal(saveEvents.some((event) => event.outcome === 'allowed'), false);
  assert.equal(rateEvents.some((event) => event.outcome === 'allowed'), false);
});
