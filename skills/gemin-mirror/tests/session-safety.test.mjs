import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAccountId,
  parseJsonOutput,
  redactAccountId,
  boundedJitter,
  isRetryableApiStatus,
  selectVerifiedAccount,
  validateExecutionOptions,
} from '../scripts/session-safety.mjs';

test('normalizeAccountId removes localized prefix', () => {
  /**
   * Given：账号证据带有中文“账号:”前缀
   * When：规范化账号标识
   * Then：只保留可比较的账号值
   * 防回归：不同镜像版本的前缀不能导致误判账号不一致
   */
  assert.equal(normalizeAccountId('账号： #3069'), '#3069');
});

test('selectVerifiedAccount fails closed on ambiguous evidence', () => {
  /**
   * Given：页面同时标记多个候选活动账号
   * When：尝试绑定 expected account
   * Then：抛出错误而不是选择第一个候选
   * 防回归：data-expanded 漂移时禁止误删
   */
  assert.throws(() => selectVerifiedAccount(['#3069', '#2899'], '#3069'), /候选数/);
});

test('parseJsonOutput accepts batch output and nested JSON', () => {
  /**
   * Given：runner 输出包含诊断行和 JSON 字符串
   * When：解析最后一个有效结果
   * Then：得到结构化对象
   * 防回归：Windows runner 的 stdout 诊断不能污染探针结果
   */
  assert.deepEqual(parseJsonOutput('diagnostic\n{\n  "count": 3\n}\n'), { count: 3 });
  assert.deepEqual(parseJsonOutput('diagnostic\n"{\\"count\\":3}"\n'), { count: 3 });
});

test('delete requires explicit confirmation unless dry-run', () => {
  /**
   * Given：用户未提供删除确认标记
   * When：校验执行选项
   * Then：实际删除被拒绝，dry-run 可通过
   * 防回归：不可逆动作不能因默认值而执行
   */
  assert.throws(() => validateExecutionOptions({ dryRun: false, confirmDelete: false, expectedAccount: '#3069' }), /confirm-delete/);
  assert.doesNotThrow(() => validateExecutionOptions({ dryRun: true, confirmDelete: false, expectedAccount: '#3069' }));
});

test('redaction is short and deterministic', () => {
  /**
   * Given：同一个账号标识
   * When：生成审计引用两次
   * Then：结果相同且不包含原始账号
   * 防回归：审计文件不能泄露完整账号标识
   */
  const ref = redactAccountId('#3069');
  assert.equal(ref, redactAccountId('#3069'));
  assert.match(ref, /^sha256:[0-9a-f]{12}$/);
  assert.equal(ref.includes('3069'), false);
});

test('API retry policy only retries rate limits and server failures', () => {
  /**
   * Given：API 返回不同 HTTP 状态码
   * When：判断是否允许自动重试
   * Then：仅 429 与 5xx 可重试，业务错误不重试
   * 防回归：避免把账号/参数错误重复提交
   */
  assert.equal(isRetryableApiStatus(429), true);
  assert.equal(isRetryableApiStatus(503), true);
  assert.equal(isRetryableApiStatus(400), false);
  assert.equal(isRetryableApiStatus(200), false);
});

test('jitter stays within configured bounds', () => {
  /**
   * Given：并发 API 删除配置了最小和最大抖动
   * When：根据随机值计算延迟
   * Then：延迟始终落在闭区间内
   * 防回归：随机延迟不能产生负数或突破限流保护上限
   */
  assert.equal(boundedJitter(0, 150, 450), 150);
  assert.equal(boundedJitter(1, 150, 450), 450);
  assert.equal(boundedJitter(0.5, 150, 450), 300);
});
