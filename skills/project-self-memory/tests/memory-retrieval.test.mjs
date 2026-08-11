import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStructuredStore, selectMemoryContext } from '../scripts/memory-retrieval.mjs';

const record = (id, content, extra = {}) => ({
  id, type: 'fact', status: 'active', content, positive: 0, negative: 0,
  created_at: '2026-08-01T00:00:00Z', ...extra,
});

/**
 * Given：一条高历史分但与任务无关的记录，以及一条低历史分但关键词相关的记录
 * When：以 relevant 模式按 deployment 任务检索
 * Then：只选择相关记录，历史分不能绕过相关性门槛
 * 防回归：高分无关记忆污染 Agent 上下文
 */
test('relevance outranks unrelated historical score', () => {
  const result = selectMemoryContext([
    record('0001', '数据库迁移历史经验', { positive: 99, negative: 0 }),
    record('0002', 'deployment 发布前必须运行 smoke test', { positive: 0, negative: 1 }),
  ], { load_mode: 'relevant', max_context_tokens: 1000, max_records: 5 }, { query: 'deployment smoke' });

  assert.deepEqual(result.records.map((item) => item.id), ['0002']);
  assert.equal(result.audit.excluded['low-relevance'], 1);
  assert.doesNotMatch(JSON.stringify(result.audit), /数据库迁移/);
});

/**
 * Given：候选包含 review/disabled、低可信、陈旧和超预算记录
 * When：执行带状态、门槛和 token/record 预算的检索
 * Then：非法状态不进入上下文，选中记录与估算 token 均不超过预算
 * 防回归：预算只作为提示而未真正限制 payload，或策展状态被自动加载
 */
test('filters state and scores and enforces both budgets', () => {
  const result = selectMemoryContext([
    record('0001', 'api deployment smoke check', { positive: 0, negative: 0 }),
    record('0002', 'api deployment stale check', { positive: 9, negative: 0, created_at: '2020-01-01T00:00:00Z' }),
    record('0003', 'api deployment review check', { status: 'review', positive: 99 }),
    record('0004', 'api deployment disabled check', { status: 'disabled', positive: 99 }),
  ], { load_mode: 'relevant', max_context_tokens: 20, max_records: 1, min_confidence: 0.6, min_freshness: 0.2 }, { query: 'api deployment' });

  assert.ok(result.records.length <= 1);
  assert.ok(result.audit.estimated_tokens <= 20);
  assert.equal(result.audit.excluded['status-review'], 1);
  assert.equal(result.audit.excluded['status-disabled'], 1);
  assert.ok(result.audit.excluded.stale || result.audit.excluded['low-confidence']);
});

/**
 * Given：两个分组中均有相关候选，第一分组拥有更多高分记录
 * When：max_records 小于第一分组候选总量
 * Then：选择结果覆盖多个分组，不让单一分组垄断预算
 * 防回归：排序实现忽略 diversity，导致同主题上下文挤占全部名额
 */
test('diversity prevents one group from monopolising records', () => {
  const result = selectMemoryContext([
    record('0001', 'deploy api one', { group: 'ops', positive: 10 }),
    record('0002', 'deploy api two', { group: 'ops', positive: 9 }),
    record('0003', 'deploy api three', { group: 'docs', positive: 0 }),
  ], { load_mode: 'relevant', max_context_tokens: 1000, max_records: 2 }, { query: 'deploy api' });

  assert.deepEqual(new Set(result.records.map((item) => item.group)), new Set(['ops', 'docs']));
});

/**
 * Given：自动加载策略为 off，候选正文中包含唯一 sentinel
 * When：执行选择函数
 * Then：返回空上下文且 audit 不包含正文
 * 防回归：关闭策略仅隐藏提示词，仍将 sentinel 注入 Agent payload
 */
test('off mode never returns sentinel body', () => {
  const result = selectMemoryContext([record('0001', 'OFF_MODE_SENTINEL')], { load_mode: 'off' }, { query: 'sentinel' });

  assert.deepEqual(result.records, []);
  assert.equal(result.memoryContext, '');
  assert.doesNotMatch(JSON.stringify(result.audit), /OFF_MODE_SENTINEL/);
});

/**
 * Given：CLI inspect 返回完整结构化 store JSON
 * When：解析 inspect 输出
 * Then：保留 records 供 retrieval 使用；非 JSON 输出被拒绝
 * 防回归：误把人读 read 输出或任意日志当作结构化候选来源
 */
test('structured inspect parsing is strict', () => {
  assert.equal(parseStructuredStore('{"records":[]}').records.length, 0);
  assert.throws(() => parseStructuredStore('[0001][事实] body'), /结构化|JSON/);
});
