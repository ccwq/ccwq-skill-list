import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemorySession } from '../scripts/memory-session.mjs';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/memory.mjs');
const run = (root, ...argv) => execFileSync(process.execPath, [cli, '--project-root', root, ...argv], { encoding: 'utf8', env: { ...process.env, PSM_QUIET: '1' } });
const tempRoots = new Set();
const temp = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-recall-'));
  tempRoots.add(root);
  return root;
};
afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.clear();
});
const memory = (root) => path.join(root, '.project-self-memory', 'memory.md');
const config = (root) => path.join(root, '.project-self-memory', 'config.yaml');
const store = (next = '0001') => `<!-- <psm-store version="1" next_id="${next}" group_dimension="" /> -->\n`;
const record = (id, content, status = 'active') => `<!-- <psm id="${id}" type="fact" status="${status}" positive="0" negative="0" created_at="2026-08-05T00:00:00Z" last_scored_at="" /> -->\n${content}\n`;

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

/** 大文本记录：生成指定 UTF-16 code unit 长度的单行正文（中文 BMP 字符每字 1 个 unit）。 */
function bigContent(totalUnits, marker) {
  const prefix = `${marker} `;
  const fill = Math.max(0, totalUnits - prefix.length);
  return prefix + '记'.repeat(fill);
}

function fakeAgent() {
  const calls = [];
  return { calls, async run(context, tools) { calls.push({ context, tools }); return {}; } };
}

function auditLog() {
  const events = [];
  return { events, emit: (event) => events.push(event) };
}

/**
 * Given：默认预算下两个相关记录，第一次召回远小于阈值
 * When：完成一次 beginTask/endTask 生命周期并检查交付结果
 * Then：首次计量结果标记已检查、估算值等于完整 memoryContext 长度除以 3 向上取整、未超限、无提醒
 * 防回归：提醒基于全库或按条取整累加，而非最终交付文本
 */
test('first successful delivery measures the final memoryContext once', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'false', auto_rate: 'false' });
  fs.writeFileSync(memory(root), store('0003')
    + record('0001', 'RECALL_ALPHA 部署前必须运行 smoke test')
    + record('0002', 'RECALL_BETA 回滚前必须确认备份可用'));
  const session = new MemorySession({ projectRoot: root, agent: fakeAgent() });
  const payload = await session.beginTask({ query: 'RECALL_ALPHA RECALL_BETA smoke 回滚' });
  await session.endTask();

  // 结构化结果必须随 payload 交付（agent 与宿主都能读到），不是只有实例属性。
  for (const usage of [payload.recallUsage, session.agent.calls[0].context.recallUsage, session.recallUsage]) {
    assert.equal(typeof usage, 'object');
    assert.equal(usage.checked, true);
    assert.equal(usage.exceeded, false);
    assert.equal(usage.threshold, 37000);
    assert.equal(usage.algorithm, 'utf16-length-div-3-ceil');
    assert.equal(usage.estimated_tokens, Math.ceil(payload.memoryContext.length / 3));
    assert.ok(usage.estimated_tokens > 0);
    assert.equal(usage.warning, null);
  }
  const warningEvents = session.auditEvents.filter((event) => event.action === 'recall-usage');
  assert.equal(warningEvents.length, 0);
});

/**
 * Given：共享计量状态已完成首次检查
 * When：第二个实例以同一状态对象开始并交付更大的非空上下文
 * Then：不重复检查、不补发提醒，共享状态保持已检查
 * 防回归：同会话后续任务重复提醒
 */
test('shared metering state suppresses the second first-use check', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'false', auto_rate: 'false' });
  fs.writeFileSync(memory(root), store('0002') + record('0001', 'SHARED_STATE 第一条结论'));
  const shared = { checked: false, estimated_tokens: null, exceeded: null };
  const first = new MemorySession({ projectRoot: root, agent: fakeAgent(), recallState: shared });
  const payload1 = await first.beginTask({ query: 'SHARED_STATE' });
  await first.endTask();
  assert.equal(shared.checked, true);
  const firstEstimate = Math.ceil(payload1.memoryContext.length / 3);
  assert.equal(shared.estimated_tokens, firstEstimate);

  fs.writeFileSync(memory(root), store('0003')
    + record('0001', 'SHARED_STATE 第一条结论')
    + record('0002', 'SHARED_STATE 第二条更长的结论补充内容'));
  const second = new MemorySession({ projectRoot: root, agent: fakeAgent(), recallState: shared });
  const payload2 = await second.beginTask({ query: 'SHARED_STATE' });
  await second.endTask();
  assert.ok(payload2.memoryContext.length > payload1.memoryContext.length);
  assert.equal(second.recallUsage.checked, false);
  assert.equal(shared.estimated_tokens, firstEstimate);
});

/**
 * Given：一个新初始化但无记录的库（空召回）
 * When：完成一次生命周期
 * Then：不消耗首次检查机会，随后放入记录的新实例仍可检查
 * 防回归：空召回消耗检查机会导致后续大召回永不提醒
 */
test('empty recall does not consume the first-use check', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'false', auto_rate: 'false' });
  const first = new MemorySession({ projectRoot: root, agent: fakeAgent() });
  const payload = await first.beginTask({ query: 'EMPTY_SENTINEL' });
  await first.endTask();
  assert.equal(payload.memoryContext, '');
  // 未检查必须表达为 checked:false，不伪装为执行后测得零。
  assert.equal(payload.recallUsage.checked, false);
  assert.equal(payload.recallUsage.estimated_tokens, null);
  assert.equal(first.recallUsage.checked, false);

  fs.writeFileSync(memory(root), store('0002') + record('0001', 'LATE_RECORD 后来放入的结论'));
  const second = new MemorySession({ projectRoot: root, agent: fakeAgent() });
  const payload2 = await second.beginTask({ query: 'LATE_RECORD' });
  await second.endTask();
  assert.ok(payload2.memoryContext.length > 0);
  assert.equal(second.recallUsage.checked, true);
  assert.equal(second.recallUsage.estimated_tokens, Math.ceil(payload2.memoryContext.length / 3));
});

/**
 * Given：auto_load=false 与加载失败两种情形
 * When：分别完成生命周期
 * Then：两者都不消耗检查机会；加载失败时上下文为空
 * 防回归：关闭加载或 fail-closed 消耗首次实际使用检查
 */
test('disabled load and load failure do not consume the check', async () => {
  const disabledRoot = temp();
  init(disabledRoot, { auto_load: 'false', auto_save: 'false', auto_rate: 'false' });
  fs.writeFileSync(memory(disabledRoot), store('0002') + record('0001', 'DISABLED_LOAD 被关闭的结论'));
  const disabled = new MemorySession({ projectRoot: disabledRoot, agent: fakeAgent() });
  await disabled.beginTask({ query: 'DISABLED_LOAD' });
  await disabled.endTask();
  assert.equal(disabled.recallUsage.checked, false);

  const failRoot = temp();
  init(failRoot, { auto_load: 'true', auto_save: 'false', auto_rate: 'false' });
  fs.writeFileSync(memory(failRoot), store('0002') + record('0001', 'LOAD_FAIL 注入的结论'));
  const calls = [];
  const failingSession = new MemorySession({
    projectRoot: failRoot,
    agent: fakeAgent(),
    runCli: ({ args, input }) => {
      calls.push([...args]);
      if (args[0] === 'read') throw new Error('模拟 read 失败');
      return { stdout: execFileSync(process.execPath, [cli, ...args, '--project-root', failRoot], { encoding: 'utf8', input }), stderr: '', status: 0 };
    },
  });
  const failPayload = await failingSession.beginTask({ query: 'LOAD_FAIL' });
  await failingSession.endTask();
  assert.equal(failPayload.memoryContext, '');
  assert.equal(failingSession.recallUsage.checked, false);
});

/**
 * Given：合成库的合法预算提高到容纳 37k 边界夹具
 * When：构造最终文本估算为 37,000 与 37,001 个 token 的两次召回
 * Then：前者不提醒，后者提醒；提醒包含估算 token、37,000 阈值、压缩或复盘建议与任务继续含义
 * 防回归：阈值比较使用 >=，或 37k 被误当作 37*1024
 */
test('threshold boundary: 37000 estimated tokens stays silent, 37001 warns', async () => {
  // 上下文行 "[0001][事实] " + content。111,000 units → 37,000 估算，不提醒。
  const linePrefix = '[0001][事实] ';
  const exactContent = bigContent(111000 - linePrefix.length, 'BOUNDARY_EXACT');
  const exactRoot = temp();
  init(exactRoot, { auto_load: 'true', auto_save: 'false', auto_rate: 'false', max_context_tokens: '10000000', max_records: '4' });
  fs.writeFileSync(memory(exactRoot), store('0002') + record('0001', exactContent));
  const exactSession = new MemorySession({ projectRoot: exactRoot, agent: fakeAgent() });
  const exactPayload = await exactSession.beginTask({ query: 'BOUNDARY_EXACT', maintenance: true, retrieval: { load_mode: 'all' } });
  await exactSession.endTask();
  assert.equal(exactPayload.memoryContext.length, 111000);
  assert.equal(Math.ceil(exactPayload.memoryContext.length / 3), 37000);
  assert.equal(exactSession.recallUsage.checked, true);
  assert.equal(exactSession.recallUsage.exceeded, false);
  assert.equal(exactSession.auditEvents.filter((event) => event.action === 'recall-usage').length, 0);

  // 111,001 units → 37,001 估算，严格大于阈值，提醒。
  const overRoot = temp();
  init(overRoot, { auto_load: 'true', auto_save: 'false', auto_rate: 'false', max_context_tokens: '10000000', max_records: '4' });
  const overContent = bigContent(111001 - linePrefix.length, 'BOUNDARY_OVER');
  fs.writeFileSync(memory(overRoot), store('0002') + record('0001', overContent));
  const overSession = new MemorySession({ projectRoot: overRoot, agent: fakeAgent() });
  const overPayload = await overSession.beginTask({ query: 'BOUNDARY_OVER', maintenance: true, retrieval: { load_mode: 'all' } });
  await overSession.endTask();
  const overEstimate = Math.ceil(overPayload.memoryContext.length / 3);
  assert.equal(overEstimate, 37001);
  assert.equal(overSession.recallUsage.exceeded, true);
  // 提醒必须同时通过 audit 通道与 payload.recallUsage 交付。
  assert.equal(overPayload.recallUsage.exceeded, true);
  assert.equal(overPayload.recallUsage.warning.message, overSession.auditEvents.find((event) => event.action === 'recall-usage').message);
  const warnings = overSession.auditEvents.filter((event) => event.action === 'recall-usage' && event.outcome === 'warning');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].estimated_tokens, 37001);
  assert.equal(warnings[0].threshold, 37000);
  assert.match(warnings[0].message, /估算 token/);
  assert.match(warnings[0].message, /37,000/);
  assert.match(warnings[0].message, /压缩或复盘记忆/);
  assert.match(warnings[0].message, /当前任务继续/);
  // 提醒不改变选择结果，也不写库。
  assert.ok(overPayload.memory.length >= 1);
});

/**
 * Given：首次超限后同一实例结束任务
 * When：检查 audit 中 recall-usage 事件数量
 * Then：只出现一次提醒（同一计量会话不重复提醒）
 * 防回归：每次读取 payload 都重新提醒
 */
test('exceeded warning fires exactly once per metering session', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'false', auto_rate: 'false', max_context_tokens: '10000000', max_records: '4' });
  const linePrefix = '[0001][事实] ';
  const content = bigContent(111001 - linePrefix.length, 'ONCE_ONLY');
  fs.writeFileSync(memory(root), store('0002') + record('0001', content));
  const session = new MemorySession({ projectRoot: root, agent: fakeAgent() });
  await session.beginTask({ query: 'ONCE_ONLY', maintenance: true, retrieval: { load_mode: 'all' } });
  await session.endTask();
  assert.equal(session.auditEvents.filter((event) => event.action === 'recall-usage').length, 1);
});

/**
 * Given：计量发生后检查库文件字节
 * When：对比生命周期前后的 memory.md 与 evidence.jsonl
 * Then：两者逐字节不变（计量与提醒是非变异操作）
 * 防回归：测量副作用污染记忆或账本
 */
test('recall measurement never mutates the store or ledger', async () => {
  const root = temp();
  init(root, { auto_load: 'true', auto_save: 'false', auto_rate: 'false', max_context_tokens: '10000000', max_records: '4' });
  const linePrefix = '[0001][事实] ';
  const content = bigContent(111001 - linePrefix.length, 'NONMUTATING');
  fs.writeFileSync(memory(root), store('0002') + record('0001', content));
  const beforeMemory = fs.readFileSync(memory(root));
  const beforeLedger = fs.readFileSync(path.join(root, '.project-self-memory', 'evidence.jsonl'));
  const session = new MemorySession({ projectRoot: root, agent: fakeAgent() });
  await session.beginTask({ query: 'NONMUTATING', maintenance: true, retrieval: { load_mode: 'all' } });
  await session.endTask();
  assert.equal(session.recallUsage.exceeded, true);
  assert.deepEqual(fs.readFileSync(memory(root)), beforeMemory);
  assert.deepEqual(fs.readFileSync(path.join(root, '.project-self-memory', 'evidence.jsonl')), beforeLedger);
});

/**
 * Given：同一实例被重复 beginTask
 * When：第二次调用
 * Then：仍然抛出既有错误（计量状态不改变实例生命周期限制）
 * 防回归：为多任务支持意外放开单实例限制
 */
test('shared recall state does not relax one beginTask per instance', async () => {
  const root = temp();
  init(root, { auto_load: 'false', auto_save: 'false', auto_rate: 'false' });
  const shared = { checked: false, estimated_tokens: null, exceeded: null };
  const session = new MemorySession({ projectRoot: root, agent: fakeAgent(), recallState: shared });
  await session.beginTask({});
  await assert.rejects(() => session.beginTask({}), /beginTask/);
  await session.endTask();
  await assert.rejects(() => session.endTask(), /endTask|可结束/);
});
