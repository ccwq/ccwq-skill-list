#!/usr/bin/env node
/**
 * Cache core for project-self-memory.
 *
 * The cache is a cross-session staging area for candidate writes produced by
 * the automatic flows. It holds raw candidates only: entries are appended and
 * never merged, so one record may accumulate contradictory entries (+1 and
 * -1, several updates) that the `-c` flow resolves with the user.
 *
 * Only the CLI reads or writes this file. The agent layer asks the CLI for
 * groups and applies one entry at a time.
 *
 * Storage is JSON Lines (one entry per line) so a reader never observes a
 * torn record: every mutation rewrites the file atomically under cache.lock.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TYPES } from './memory-store.mjs';

export const CACHE_FILE = 'cache.jsonl';
export const CACHE_LOCK_FILE = 'cache.lock';
export const CACHE_VERSION = 1;

/** The five candidate operations a cache entry may describe. */
export const CACHE_OPS = new Set(['add', 'update', 'delete', '+1', '-1']);
/** Persistent entry states. `stale` is derived at read time, never stored. */
const CACHE_STATUSES = new Set(['pending', 'applied', 'discarded']);
const ENTRY_KEYS = new Set([
  'event_id', 'type', 'target_refid', 'target_record_version', 'base_content',
  'payload', 'evidence', 'source', 'created_at', 'processed_at', 'status',
]);
const EVIDENCE_KEYS = new Set(['reason', 'observation', 'event_id', 'kind', 'observed_at']);
/** Pending backlog above this count produces a non-blocking warning. */
export const PENDING_WARNING_THRESHOLD = 20;
/** Ledger kinds an automatic flow can originate; they keep source=automatic. */
export const AUTOMATIC_EVIDENCE_KINDS = new Set(['applied_success', 'applied_failure', 'still_valid']);

export function cachePaths(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const base = path.join(root, '.project-self-memory');
  return { root, base, file: path.join(base, CACHE_FILE), lock: path.join(base, CACHE_LOCK_FILE) };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Stable idempotency key: hash(operation + target + payload fingerprint +
 * session source).
 *
 * The session dimension is what makes 「同一操作在同一会话内重复触发不重复堆条目」
 * and 「每条每会话一次投票」两件事同时成立：同一会话内的同一操作得同一个 id
 * 并被去重；换一个会话再提一次则是新候选，按卡 01「重复新增原样留存」留在
 * cache 里交给 `-c` 取舍，而不是被静默合并。
 */
export function cacheEventId({ type, target_refid = '', fingerprint = '', source = '' }) {
  const canonical = JSON.stringify([String(type), String(target_refid), String(fingerprint), String(source)]);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}

/** Payload fingerprint: exactly what the entry would write, nothing else. */
export function payloadFingerprint({ content = null, record_type = null, group = null } = {}) {
  if (content === null || content === undefined) return '';
  return crypto.createHash('sha256')
    .update(JSON.stringify([String(content), record_type ?? null, group ?? null]), 'utf8')
    .digest('hex');
}

export function normaliseEvidence(evidence) {
  if (evidence === undefined || evidence === null) {
    return { reason: '', observation: '', event_id: null, kind: null, observed_at: null };
  }
  if (!isPlainObject(evidence)) throw Error('evidence 必须是对象');
  for (const key of Object.keys(evidence)) if (!EVIDENCE_KEYS.has(key)) throw Error(`evidence 含未知字段: ${key}`);
  const text = (value) => (value === undefined || value === null ? '' : String(value));
  const nullable = (value) => (value === undefined || value === null ? null : String(value));
  const observedAt = nullable(evidence.observed_at);
  // 观察时间只在账本可接受的 UTC 秒级格式下保留；其余丢弃，由落库时补当前时间。
  if (observedAt !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(observedAt)) {
    throw Error('evidence.observed_at 必须是 UTC 秒级时间（如 2026-10-24T00:00:00Z）');
  }
  return {
    reason: text(evidence.reason),
    observation: text(evidence.observation),
    event_id: nullable(evidence.event_id),
    kind: nullable(evidence.kind),
    observed_at: observedAt,
  };
}

/** 载荷：新增或修改的正文、记录类型与分组；无正文的操作为 null。 */
export function normalisePayload(payload) {
  if (payload === undefined || payload === null) return null;
  if (!isPlainObject(payload)) throw Error('payload 必须是对象');
  for (const key of Object.keys(payload)) {
    if (!['content', 'record_type', 'group'].includes(key)) throw Error(`payload 含未知字段: ${key}`);
  }
  const content = payload.content === undefined || payload.content === null ? null : String(payload.content);
  const recordType = payload.record_type === undefined || payload.record_type === null ? null : String(payload.record_type);
  const group = payload.group === undefined || payload.group === null ? null : String(payload.group);
  return { content, record_type: recordType, group };
}

export function normaliseEntry(entry) {
  if (!isPlainObject(entry)) throw Error('cache 条目必须是 JSON 对象');
  for (const key of Object.keys(entry)) if (!ENTRY_KEYS.has(key)) throw Error(`cache 条目含未知字段: ${key}`);
  const type = String(entry.type || '');
  if (!CACHE_OPS.has(type)) throw Error(`cache 条目 type 非法: ${type}`);
  const status = String(entry.status || '');
  if (!CACHE_STATUSES.has(status)) throw Error(`cache 条目 status 非法: ${status}`);
  const eventId = String(entry.event_id || '');
  if (!/^[a-f0-9]{32}$/.test(eventId)) throw Error(`cache 条目 event_id 非法: ${eventId}`);
  const target = entry.target_refid === undefined || entry.target_refid === null ? null : String(entry.target_refid);
  const targetVersion = entry.target_record_version === undefined || entry.target_record_version === null
    ? null : String(entry.target_record_version);
  if ((type === 'add') !== (target === null)) throw Error('cache 条目 target_refid 与 type 不匹配');
  if (target !== null && !/^(?:\d{4}|[1-9]\d{4,})$/.test(target)) throw Error(`cache 条目 target_refid 非法: ${target}`);
  if (targetVersion !== null && !/^[a-f0-9]{64}$/.test(targetVersion)) throw Error('cache 条目 target_record_version 非法');
  const payload = normalisePayload(entry.payload);
  if ((type === 'add' || type === 'update') !== (payload !== null)) throw Error('cache 条目 payload 与 type 不匹配');
  if (payload && payload.record_type !== null && !TYPES.has(payload.record_type)) {
    throw Error(`cache 条目 payload.record_type 非法: ${payload.record_type}`);
  }
  const baseContent = entry.base_content === undefined || entry.base_content === null ? null : String(entry.base_content);
  if (baseContent !== null && target === null) throw Error('cache 条目 base_content 只适用于有目标记录的条目');
  const processedAt = entry.processed_at === undefined || entry.processed_at === null ? null : String(entry.processed_at);
  if (processedAt !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(processedAt)) {
    throw Error(`cache 条目 processed_at 非法: ${processedAt}`);
  }
  if (processedAt !== null && status === 'pending') throw Error('cache 条目 processed_at 只适用于已处理条目');
  return {
    event_id: eventId,
    type,
    target_refid: target,
    target_record_version: targetVersion,
    base_content: baseContent,
    payload,
    evidence: normaliseEvidence(entry.evidence),
    source: String(entry.source || ''),
    created_at: String(entry.created_at || ''),
    processed_at: processedAt,
    status,
  };
}

/** Parse the whole cache. A malformed entry is fatal: never drop evidence. */
export function parseCache(text) {
  if (typeof text !== 'string') throw new TypeError('cache 文本必须是字符串');
  if (!text.trim()) return [];
  if (!text.endsWith('\n')) throw Error('cache 文件末行不完整，拒绝加载');
  const entries = [];
  const seen = new Set();
  const lines = text.split('\n').slice(0, -1);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) throw Error(`cache 文件含空白行 (line ${index + 1})`);
    let entry;
    try {
      entry = normaliseEntry(JSON.parse(line));
    } catch (error) {
      throw Error(`cache 条目非法 (line ${index + 1}): ${error.message}`);
    }
    if (seen.has(entry.event_id)) throw Error(`cache 条目 event_id 重复: ${entry.event_id}`);
    seen.add(entry.event_id);
    entries.push(entry);
  }
  return entries;
}

export function readCache(projectRoot) {
  const { file } = cachePaths(projectRoot);
  if (!fs.existsSync(file)) return [];
  return parseCache(fs.readFileSync(file, 'utf8'));
}

function serialiseCache(entries) {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join('');
}

/** Rewrite the cache file atomically. The caller holds cache.lock. */
export function writeCache(projectRoot, entries) {
  const { file, base } = cachePaths(projectRoot);
  fs.mkdirSync(base, { recursive: true });
  const bytes = Buffer.from(serialiseCache(entries), 'utf8');
  const temp = `${file}.psm-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(temp, bytes);
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* temp may not exist */ }
    throw error;
  }
}

/**
 * Derive the stale marker for every pending entry.
 *
 * `versions` maps record id to the current record version; `null` means the
 * version could not be determined (store unavailable), in which case staleness
 * stays unknown rather than being guessed.
 */
export function deriveStale(entries, versions) {
  return entries.map((entry) => {
    if (entry.status !== 'pending' || entry.target_refid === null) return { ...entry, stale: false };
    if (!versions) return { ...entry, stale: null };
    const current = versions.get(entry.target_refid);
    if (current === undefined) return { ...entry, stale: true };
    return { ...entry, stale: current !== entry.target_record_version };
  });
}

/**
 * Group pending entries for the `-c` flow.
 *
 * - stale entries form their own group per target record;
 * - entries that target an existing record group by target refid;
 * - `add` entries stand alone, one candidate per group.
 */
export function groupEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const stale = entry.stale === true;
    const key = entry.target_refid === null
      ? `new:${entry.event_id}`
      : (stale ? `stale:${entry.target_refid}` : `target:${entry.target_refid}`);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        kind: entry.target_refid === null ? 'new' : (stale ? 'stale' : 'target'),
        refid: entry.target_refid,
        stale,
        entries: [],
      });
    }
    groups.get(key).entries.push(entry);
  }
  const result = [...groups.values()];
  for (const group of result) {
    const votes = new Set(group.entries.filter((entry) => entry.type === '+1' || entry.type === '-1').map((entry) => entry.type));
    const updates = group.entries.filter((entry) => entry.type === 'update').length;
    group.conflict = votes.size > 1 || updates > 1 || (votes.size === 1 && group.entries.length > 1);
    group.count = group.entries.length;
  }
  return result;
}
