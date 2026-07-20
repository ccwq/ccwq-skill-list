import { createHash } from 'node:crypto';

export function normalizeAccountId(value) {
  return String(value ?? '').replace(/^账号\s*[:：]\s*/u, '').trim();
}

export function redactAccountId(accountId) {
  return `sha256:${createHash('sha256').update(normalizeAccountId(accountId)).digest('hex').slice(0, 12)}`;
}

export function validateExecutionOptions({ dryRun, confirmDelete, expectedAccount }) {
  if (!expectedAccount) throw new Error('缺少 --expected-account；无法核验当前账号，已停止。');
  if (!dryRun && !confirmDelete) throw new Error('删除操作需要 --confirm-delete，已停止。');
}

export function selectVerifiedAccount(candidates, expected) {
  const unique = [...new Set((Array.isArray(candidates) ? candidates : [])
    .map(normalizeAccountId).filter(Boolean))];
  const wanted = normalizeAccountId(expected);
  if (unique.length !== 1) throw new Error(`无法唯一确定当前账号（候选数：${unique.length}），已停止。`);
  if (unique[0] !== wanted) throw new Error('当前账号与 --expected-account 不匹配，已停止。');
  return unique[0];
}

export function parseJsonOutput(output) {
  const text = String(output ?? '').trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = [text];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith('{') || lines[index].startsWith('[')) candidates.push(lines.slice(index).join('\n'));
  }
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return value; }
      }
      return value;
    } catch { /* try the next framing */ }
  }
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return value; }
      }
      return value;
    } catch { /* ignore diagnostics and continue backwards */ }
  }
  return lines.at(-1) ?? '';
}

export function isRetryableApiStatus(status) {
  return status === 429 || status >= 500;
}

export function boundedJitter(randomValue, minMs, maxMs) {
  const min = Math.max(0, Number(minMs) || 0);
  const max = Math.max(min, Number(maxMs) || min);
  const value = Number.isFinite(randomValue) ? randomValue : Math.random();
  return Math.round(min + Math.min(1, Math.max(0, value)) * (max - min));
}
