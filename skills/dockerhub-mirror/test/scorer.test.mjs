import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRecords, recommendations } from '../scripts/lib/scorer.mjs';

const options = {
  staleDays: 7,
  weights: { manifestLatency: 0.3, throughput: 0.3, successRate: 0.2, apiLatency: 0.1, freshness: 0.1 }
};

/**
 * Given：成功、较慢和失败的候选镜像记录
 * When：执行评分与场景推荐
 * Then：失败候选被硬排除，最快的合格候选成为推荐
 * 防回归：避免失败镜像因历史指标残留而进入推荐结果
 */
test('applies hard failure exclusion and scenario recommendations', () => {
  const now = new Date().toISOString();
  const scored = scoreRecords([
    { url: 'https://fast.example', ok: true, api_ms: 20, manifest_ms: 50, throughput_kib_s: 1000, success_count: 9, failure_count: 1, tested_at: now },
    { url: 'https://slow.example', ok: true, api_ms: 100, manifest_ms: 300, throughput_kib_s: 400, success_count: 10, failure_count: 0, tested_at: now },
    { url: 'https://failed.example', ok: false, api_ms: null, manifest_ms: null, tested_at: now }
  ], options);
  const recs = recommendations(scored);
  assert.equal(recs.best.url, 'https://fast.example');
  assert.equal(scored.find((x) => x.url.includes('failed')).score, 0);
  assert.ok(recs.mostStable);
});
