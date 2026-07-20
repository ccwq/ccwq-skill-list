import { createHash } from 'node:crypto';

export function normalizeAccountId(value) {
  return String(value || '').replace(/^账号\s*[:：]\s*/u, '').trim();
}

export function redactAccountId(accountId) {
  return `sha256:${createHash('sha256').update(normalizeAccountId(accountId)).digest('hex').slice(0, 12)}`;
}

export function validateExecutionOptions({ dryRun, confirmDelete, expectedAccount }) {
  if (!expectedAccount) throw new Error('缺少 --expected-account；无法核验当前账号，已停止。');
  if (!dryRun && !confirmDelete) throw new Error('删除操作需要 --confirm-delete，已停止。');
}

export function selectVerifiedAccount(candidates, expected) {
  const unique = [...new Set((Array.isArray(candidates) ? candidates : []).map(normalizeAccountId).filter(Boolean))];
  if (unique.length !== 1) throw new Error(`无法从账号面板唯一确定当前账号（候选数：${unique.length}），已停止。`);
  if (unique[0] !== normalizeAccountId(expected)) throw new Error('当前账号与 --expected-account 不匹配，已停止。');
  return unique[0];
}
