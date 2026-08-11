#!/usr/bin/env node
/**
 * Append-only, body-free evidence ledger for project-self-memory.
 *
 * The ledger deliberately lives outside memory.md.  memory.md remains the
 * human-curated source of record text while this file is the durable source
 * for score projections and provenance.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LEDGER_VERSION = 1;
export const LEDGER_FILE = 'evidence.jsonl';
export const LOCK_FILE = 'evidence.lock';

export const EVENT_KINDS = new Set([
  'human_positive',
  'human_negative',
  'applied_success',
  'applied_failure',
  'still_valid',
  'review_candidate',
  'legacy_positive',
  'legacy_negative',
  'projection_reset',
  'projection_repair',
  'merge_lineage',
]);
export const EVENT_SOURCES = new Set(['manual', 'automatic', 'migration', 'system']);
const SCORE_KINDS = new Set(['human_positive', 'human_negative', 'applied_success', 'applied_failure', 'still_valid', 'legacy_positive', 'legacy_negative']);
const POSITIVE_KINDS = new Set(['human_positive', 'applied_success', 'still_valid', 'legacy_positive']);
const NEGATIVE_KINDS = new Set(['human_negative', 'applied_failure', 'legacy_negative']);
const EVENT_KEYS = new Set([
  'schema_version', 'event_id', 'record_id', 'record_version', 'task_id', 'kind',
  'observed_at', 'source', 'quantity', 'projection',
  'lineage',
]);
const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const RECORD_ID_RE = /^(?:\d{4}|[1-9]\d{4,})$/;
const VERSION_RE = /^[a-f0-9]{64}$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function ledgerPaths(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const base = path.join(root, '.project-self-memory');
  return { root, base, ledger: path.join(base, LEDGER_FILE), lock: path.join(base, LOCK_FILE) };
}

export function recordVersion(record) {
  if (!record || typeof record !== 'object') throw new TypeError('record 必须是对象');
  const semantic = {
    id: String(record.id || ''),
    type: String(record.type || ''),
    status: String(record.status || ''),
    group: record.group ?? null,
    content: String(record.content || '').replace(/\r\n/g, '\n').trim(),
  };
  return crypto.createHash('sha256').update(JSON.stringify(semantic), 'utf8').digest('hex');
}

function issue(message, line = undefined, kind = 'ledger') {
  return { kind, message, ...(line === undefined ? {} : { line }), impact: 'fatal' };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalEvent(event) {
  return JSON.stringify(event);
}

function validateProjection(value) {
  if (!isPlainObject(value)) throw Error('projection 必须是对象');
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'positive' && key !== 'negative')) throw Error('projection 只允许 positive/negative');
  for (const key of ['positive', 'negative']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw Error(`projection.${key} 必须是非负安全整数`);
  }
}

function validateLineage(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw Error('lineage 必须是 1..100 项数组');
  for (const item of value) {
    if (!isPlainObject(item) || Object.keys(item).some((key) => key !== 'record_id' && key !== 'record_version')) {
      throw Error('lineage 项字段非法');
    }
    if (!RECORD_ID_RE.test(String(item.record_id || '')) || !VERSION_RE.test(String(item.record_version || ''))) {
      throw Error('lineage 项必须包含合法 record_id/record_version');
    }
  }
}

function validateEvent(event, line = undefined) {
  if (!isPlainObject(event)) throw Error('事件必须是 JSON 对象');
  for (const key of Object.keys(event)) if (!EVENT_KEYS.has(key)) throw Error(`事件含未知字段: ${key}`);
  if (event.schema_version !== LEDGER_VERSION) throw Error(`不支持 evidence schema 版本: ${event.schema_version}`);
  for (const key of ['event_id', 'record_id', 'record_version', 'task_id', 'kind', 'observed_at', 'source']) {
    if (typeof event[key] !== 'string' || !event[key]) throw Error(`事件缺少合法 ${key}`);
  }
  if (!EVENT_ID_RE.test(event.event_id) || !EVENT_ID_RE.test(event.task_id)) throw Error('event_id/task_id 含非法字符');
  if (!RECORD_ID_RE.test(event.record_id)) throw Error(`非法 record_id: ${event.record_id}`);
  if (!VERSION_RE.test(event.record_version)) throw Error('record_version 必须是 sha256 摘要');
  if (!EVENT_KINDS.has(event.kind)) throw Error(`未知 evidence kind: ${event.kind}`);
  if (!TIME_RE.test(event.observed_at) || Number.isNaN(Date.parse(event.observed_at))) throw Error('observed_at 必须是 UTC 秒级时间');
  if (!EVENT_SOURCES.has(event.source)) throw Error(`未知 evidence source: ${event.source}`);
  if (event.quantity !== undefined && (!Number.isSafeInteger(event.quantity) || event.quantity < 1 || event.quantity > 1000000)) throw Error('quantity 必须是 1..1000000 的整数');
  if (event.projection !== undefined) validateProjection(event.projection);
  if (event.lineage !== undefined) validateLineage(event.lineage);
  if (event.kind === 'projection_repair' && event.projection === undefined) throw Error('projection_repair 必须包含 projection');
  if (event.kind === 'projection_reset' && event.projection !== undefined) throw Error('projection_reset 不得包含 projection');
  return event;
}

export function parseLedger(text) {
  if (typeof text !== 'string') throw new TypeError('ledger 文本必须是字符串');
  if (!text) return { events: [], byId: new Map(), errors: [] };
  if (!text.endsWith('\n')) throw Error('evidence ledger 末行不完整，拒绝加载');
  const events = [];
  const byId = new Map();
  const errors = [];
  const lines = text.split('\n').slice(0, -1);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      errors.push(issue('evidence ledger 含空白行', index + 1));
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
      validateEvent(event, index + 1);
    } catch (error) {
      errors.push(issue(error.message, index + 1));
      continue;
    }
    const existing = byId.get(event.event_id);
    if (existing && canonicalEvent(existing) !== canonicalEvent(event)) {
      errors.push(issue(`event_id 冲突: ${event.event_id}`, index + 1));
      continue;
    }
    if (!existing) {
      byId.set(event.event_id, event);
      events.push(event);
    }
  }
  if (errors.length) throw Error(errors.map((error) => `${error.message}${error.line ? ` (line ${error.line})` : ''}`).join('；'));
  return { events, byId, errors };
}

export function readLedger(projectRoot, { required = true } = {}) {
  const file = ledgerPaths(projectRoot).ledger;
  if (!fs.existsSync(file)) {
    if (required) throw Error('缺少 evidence ledger；先运行 init 或 evidence migrate');
    return { events: [], byId: new Map(), errors: [], missing: true };
  }
  return { ...parseLedger(fs.readFileSync(file, 'utf8')), missing: false };
}

export function initializeLedger(projectRoot) {
  const { base, ledger } = ledgerPaths(projectRoot);
  fs.mkdirSync(base, { recursive: true });
  if (!fs.existsSync(ledger)) fs.writeFileSync(ledger, '');
}

function sleep(ms) {
  const until = Date.now() + ms;
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, Math.max(1, ms));
  return until;
}

function withLock(projectRoot, action, { timeoutMs = 15000 } = {}) {
  const { base, lock } = ledgerPaths(projectRoot);
  fs.mkdirSync(base, { recursive: true });
  const started = Date.now();
  let acquired = false;
  while (!acquired) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
      fs.closeSync(fd);
      acquired = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(lock);
        if (Date.now() - stat.mtimeMs > timeoutMs * 2) fs.unlinkSync(lock);
      } catch { /* another writer may have released it */ }
      if (Date.now() - started >= timeoutMs) throw Error('evidence ledger 锁超时，拒绝写入');
      sleep(15);
    }
  }
  try { return action(); } finally { try { fs.unlinkSync(lock); } catch { /* lock already released */ } }
}

function defaultEventId(input) {
  return `manual-${crypto.randomUUID()}`;
}

export function appendEvent(projectRoot, input) {
  return withLock(projectRoot, () => {
    const current = readLedger(projectRoot);
    const event = {
      schema_version: LEDGER_VERSION,
      event_id: input.event_id || defaultEventId(input),
      record_id: String(input.record_id || input.recordId || ''),
      record_version: String(input.record_version || input.recordVersion || ''),
      task_id: String(input.task_id || input.taskId || `manual-${process.pid}`),
      kind: String(input.kind || ''),
      observed_at: input.observed_at || input.observedAt || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      source: String(input.source || 'manual'),
    };
    if (input.quantity !== undefined) event.quantity = input.quantity;
    if (input.projection !== undefined) event.projection = input.projection;
    if (input.lineage !== undefined) event.lineage = input.lineage;
    validateEvent(event);
    const existing = current.byId.get(event.event_id);
    if (existing) {
      // observed_at is generated by the host when omitted. It must not turn a
      // retried stable event into a false conflict across process restarts.
      const comparable = (item) => { const { observed_at, ...rest } = item; return rest; };
      if (canonicalEvent(comparable(existing)) !== canonicalEvent(comparable(event))) throw Error(`event_id 冲突: ${event.event_id}`);
      return { applied: false, duplicate: true, event: existing, projection: projectEvents(current.events, event.record_id, event.record_version) };
    }
    fs.appendFileSync(ledgerPaths(projectRoot).ledger, `${canonicalEvent(event)}\n`, 'utf8');
    const events = [...current.events, event];
    return { applied: true, duplicate: false, event, projection: projectEvents(events, event.record_id, event.record_version) };
  });
}

export function projectEvents(events, recordId, recordVersion) {
  const relevant = events.filter((event) => event.record_id === String(recordId) && event.record_version === String(recordVersion));
  let positive = 0;
  let negative = 0;
  let lastScoredAt = '';
  const lineage = [];
  for (const event of relevant) {
    if (event.kind === 'projection_reset') { positive = 0; negative = 0; lastScoredAt = ''; }
    else if (event.kind === 'projection_repair') {
      positive = event.projection.positive;
      negative = event.projection.negative;
      lastScoredAt = event.observed_at;
    }
    else {
      const quantity = event.quantity || 1;
      if (POSITIVE_KINDS.has(event.kind)) positive += quantity;
      if (NEGATIVE_KINDS.has(event.kind)) negative += quantity;
      if (SCORE_KINDS.has(event.kind) && event.observed_at > lastScoredAt) lastScoredAt = event.observed_at;
    }
    if (Array.isArray(event.lineage)) for (const item of event.lineage) {
      if (!lineage.some((entry) => entry.record_id === item.record_id && entry.record_version === item.record_version)) lineage.push(item);
    }
  }
  return { positive, negative, last_scored_at: lastScoredAt, event_count: relevant.length, lineage };
}

export function projectRecord(projectRoot, record) {
  const ledger = readLedger(projectRoot);
  return { ...record, ...projectEvents(ledger.events, record.id, recordVersion(record)), record_version: recordVersion(record) };
}

export function inspectLedger(projectRoot, filters = {}) {
  const ledger = readLedger(projectRoot);
  const events = ledger.events.filter((event) => (!filters.event_id || event.event_id === filters.event_id)
    && (!filters.record_id || event.record_id === String(filters.record_id))
    && (!filters.record_version || event.record_version === filters.record_version));
  return { schema_version: LEDGER_VERSION, path: ledgerPaths(projectRoot).ledger, count: events.length, events };
}

export function validateLedger(projectRoot) {
  const ledger = readLedger(projectRoot);
  return { schema_version: LEDGER_VERSION, path: ledgerPaths(projectRoot).ledger, count: ledger.events.length, valid: true };
}

export function migrateLegacyScores(projectRoot, records) {
  initializeLedger(projectRoot);
  const ledger = readLedger(projectRoot, { required: false });
  const migrated = [];
  for (const record of records) {
    const version = recordVersion(record);
    for (const [kind, count] of [['legacy_positive', record.positive], ['legacy_negative', record.negative]]) {
      if (!Number.isSafeInteger(count) || count < 0 || count > 1000000) throw Error(`记录 ${record.id} 的历史评分非法`);
      for (let index = 0; index < count; index += 1) {
        migrated.push(appendEvent(projectRoot, {
          event_id: `legacy-${record.id}-${version.slice(0, 16)}-${kind}-${index + 1}`,
          record_id: record.id,
          record_version: version,
          task_id: 'legacy-migration',
          kind,
          source: 'migration',
          observed_at: record.last_scored_at || record.created_at,
        }));
      }
    }
  }
  return { migrated: migrated.filter((item) => item.applied).length, duplicates: migrated.filter((item) => item.duplicate).length };
}
