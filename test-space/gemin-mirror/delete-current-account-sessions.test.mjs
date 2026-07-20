import assert from 'node:assert/strict';
import test from 'node:test';
import {
  redactAccountId,
  selectVerifiedAccount,
  validateExecutionOptions,
} from '../../skills/gemin-mirror/scripts/session-safety.mjs';

/**
 * Given：未提供删除确认，但已提供预期账号。
 * When：校验实际删除的执行参数。
 * Then：脚本在调用浏览器前拒绝执行。
 * 防回归：避免脱离 Skill 流程直接运行脚本时误删会话。
 */
test('实际删除缺少确认标记时 fail-closed', () => {
  assert.throws(
    () => validateExecutionOptions({ dryRun: false, confirmDelete: false, expectedAccount: '#3069' }),
    /--confirm-delete/u,
  );
});

/**
 * Given：请求以 dry-run 方式运行脚本，但没有预期账号。
 * When：校验执行参数。
 * Then：脚本拒绝继续，因为只读探针也不能猜测当前账号。
 * 防回归：避免以后把 `--dry-run` 变成绕过账号核验的路径。
 */
test('所有模式缺少预期账号时 fail-closed', () => {
  assert.throws(
    () => validateExecutionOptions({ dryRun: true, confirmDelete: false, expectedAccount: '' }),
    /--expected-account/u,
  );
});

/**
 * Given：账号面板存在多个展开账号卡片。
 * When：以用户确认的账号 ID 核验当前账号。
 * Then：脚本拒绝以不唯一的候选推断当前账号。
 * 防回归：避免切换状态不明确时删除错误账号的会话。
 */
test('账号候选不唯一时 fail-closed', () => {
  assert.throws(
    () => selectVerifiedAccount(['账号: #3069', '账号: #4040'], '#3069'),
    /唯一确定/u,
  );
});

/**
 * Given：账号面板只有一个账号，但它不是用户确认的目标账号。
 * When：脚本核验当前账号。
 * Then：脚本停止，不进入删除流程。
 * 防回归：避免用户切换账号后脚本仍继续清理旧目标的会话。
 */
test('账号与预期不匹配时 fail-closed', () => {
  assert.throws(
    () => selectVerifiedAccount(['账号: #4040'], '#3069'),
    /不匹配/u,
  );
});

/**
 * Given：账号面板只有一个与预期一致的账号。
 * When：生成审计账号引用。
 * Then：引用稳定但不包含完整账号 ID。
 * 防回归：保留可关联审计能力，同时避免账号 ID 泄露到本地日志。
 */
test('审计账号引用稳定且脱敏', () => {
  const account = selectVerifiedAccount(['账号: #3069'], '#3069');
  const first = redactAccountId(account);
  assert.equal(first, redactAccountId(account));
  assert.match(first, /^sha256:[a-f0-9]{12}$/u);
  assert.doesNotMatch(first, /3069/u);
});
