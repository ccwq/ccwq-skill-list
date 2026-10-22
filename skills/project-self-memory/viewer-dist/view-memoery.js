#!/usr/bin/env node
/*
 * view-memoery.js — project-self-memory 紧凑查看器（自包含单文件产物）。
 *
 * 由 skills/project-self-memory/scripts/build-viewer.mjs 生成。
 * 重新生成：node scripts/build-viewer.mjs
 * 一致性校验（不写文件）：node scripts/build-viewer.mjs --check
 *
 * 运行要求：Node 22+（以 Node 24 验证）。无第三方依赖；不访问网络；
 * 只监听 127.0.0.1；记忆目录固定为脚本旁的 .project-self-memory/。
 *
 * 用法：
 *   node view-memoery.js [--port N]
 * 输出：带 #token= 的访问地址。令牌只在进程与页面内存中，不写入磁盘。
 */
'use strict';

(async () => {
const [fs, path, crypto, http] = await Promise.all([
  import('node:fs').then((m) => m.default || m),
  import('node:path').then((m) => m.default || m),
  import('node:crypto').then((m) => m.default || m),
  import('node:http').then((m) => m.default || m),
]);

const storeFactory = (deps) => {
/**
 * Shared store core for project-self-memory.
 *
 * memory.mjs (CLI) and the view-memoery.js builder both consume this module so
 * parsing, validation and serialization never drift between the two writers.
 * The module carries no process or network behaviour; callers inject the
 * project root and perform I/O themselves.
 */

const TYPES = new Set(['experience', 'pitfall', 'decision', 'constraint', 'fact']);
const STATUS = new Set(['active', 'review', 'disabled']);
const TYPE_LABEL = { experience: '经验', pitfall: '避坑', decision: '决策', constraint: '约束', fact: '事实' };
const RECORD_KEYS = ['id', 'type', 'status', 'positive', 'negative', 'created_at', 'last_scored_at'];
const STORE_KEYS = ['version', 'next_id', 'group_dimension'];
const GROUP_KEYS = ['id', 'scope'];

function escapeXml(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function unescapeXml(value) { return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

// The format is XML-like, not XML. This deliberately rejects all XML features.
function parseElement(line, name, required) {
  const wrapped = line.trim().match(/^<!--\s*(<[^>]*>)\s*-->$/);
  if (!wrapped) return null;
  const text = wrapped[1];
  if (/<!|<\/|^<[\w-]+:/.test(text)) throw Error('不支持 DOCTYPE、CDATA、命名空间或嵌套 XML');
  const match = text.match(new RegExp(`^<${name}(?:\\s+([^>]*?))?\\s*/>$`));
  if (!match) return null;
  const attrs = {};
  const source = match[1] || '';
  const re = /([A-Za-z_][\w-]*)="((?:[^"<&]|&(amp|quot|lt|gt);)*)"\s*/g;
  let end = 0; let item;
  while ((item = re.exec(source))) {
    if (item.index !== end) throw Error(`畸形属性或未加引号属性: ${source}`);
    if (!required.includes(item[1]) || Object.hasOwn(attrs, item[1])) throw Error(`未知或重复属性: ${item[1]}`);
    attrs[item[1]] = unescapeXml(item[2]); end = re.lastIndex;
  }
  if (end !== source.length) throw Error(`畸形 XML-like 标签: ${text}`);
  for (const key of required) if (!Object.hasOwn(attrs, key)) throw Error(`缺少必需属性: ${key}`);
  return attrs;
}

function isHeading(line) { return /^##\s+\S/.test(line); }
function validTime(value, empty = false) { return (empty && value === '') || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value); }
// Legacy examples use four digits (0001). Above four digits no leading zero is canonical.
function canonicalId(value) { return /^(?:\d{4}|[1-9]\d{4,})$/.test(value); }
function issue(kind, message, extra = {}) { return { kind, message, ...extra }; }

function parseStore(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const errors = []; const records = []; const groups = []; const legacy = [];
  let store; try { store = parseElement(lines[0] || '', 'psm-store', STORE_KEYS); } catch (e) { errors.push(issue('store', e.message, { line: 1, impact: 'fatal' })); }
  if (!store) errors.push(issue('store', '首行必须是完整 psm-store', { line: 1, impact: 'fatal' }));
  if (/<\s*!DOCTYPE|<!\[CDATA\[|<[\w-]+:/i.test(text)) errors.push(issue('store', '任意位置禁止 DOCTYPE、CDATA 与 XML namespace', { impact: 'fatal' }));
  let activeGroup = null;
  for (let i = 1; i < lines.length;) {
    const line = lines[i];
    let recordTag; let groupTag;
    try { recordTag = parseElement(line, 'psm', RECORD_KEYS); groupTag = parseElement(line, 'psm-group', GROUP_KEYS); } catch (e) { errors.push(issue('record', e.message, { line: i + 1, impact: 'isolated' })); legacy.push(line); i++; continue; }
    if (isHeading(line)) {
      let next = null; try { next = parseElement(lines[i + 1] || '', 'psm-group', GROUP_KEYS); } catch (e) { errors.push(issue('group', e.message, { line: i + 2, impact: 'fatal' })); }
      if (next) { activeGroup = { ...next, title: line.replace(/^##\s+/, '').trim() }; groups.push(activeGroup); i += 2; continue; }
      // A Markdown heading without a valid immediate group marker belongs to the record body.
    }
    if (groupTag) { errors.push(issue('group', 'psm-group 必须紧跟 ## 标题', { line: i + 1, impact: 'fatal' })); i++; continue; }
    if (recordTag) {
      const start = i++; const body = [];
      while (i < lines.length) {
        let nextRecord;
        try { nextRecord = parseElement(lines[i], 'psm', RECORD_KEYS); } catch { nextRecord = null; }
        // A heading closes the body only when it introduces a group marker on
        // the immediately following line (the canonical serialized layout).
        // Headings without one stay part of the record body.
        let closes = false;
        if (isHeading(lines[i])) {
          try { closes = !!parseElement(lines[i + 1] || '', 'psm-group', GROUP_KEYS); } catch { closes = false; }
        }
        if (nextRecord || closes || lines[i].trim().startsWith('<!-- <')) break;
        body.push(lines[i++]);
      }
      const record = { ...recordTag, positive: Number(recordTag.positive), negative: Number(recordTag.negative), content: body.join('\n').trim(), group: activeGroup?.id || null, line: start + 1 };
      const invalid = !canonicalId(record.id) || !TYPES.has(record.type) || !STATUS.has(record.status) || !Number.isSafeInteger(record.positive) || record.positive < 0 || !Number.isSafeInteger(record.negative) || record.negative < 0 || !validTime(record.created_at) || !validTime(record.last_scored_at, true) || !record.content;
      if (invalid) errors.push(issue('record', `记录 ${record.id || '?'} 的固定字段或正文非法`, { line: record.line, id: record.id, impact: 'isolated' }));
      records.push(record); continue;
    }
    if (line.trim().startsWith('<!-- <')) { errors.push(issue('record', '未知或畸形 XML-like 元素', { line: i + 1, impact: 'isolated' })); legacy.push(line); i++; continue; }
    if (line.trim()) legacy.push(line);
    i++;
  }
  const ids = new Set();
  for (const record of records) { const numeric = /^\d+$/.test(record.id) ? BigInt(record.id).toString() : record.id; if (ids.has(numeric)) errors.push(issue('store', `重复 ID 数值: ${record.id}`, { id: record.id, impact: 'fatal' })); ids.add(numeric); }
  for (const group of groups) if (!/^[a-z0-9][a-z0-9-]*$/.test(group.id) || !group.scope || !group.title) errors.push(issue('group', `非法分组: ${group.id}`, { impact: 'fatal' }));
  return { store, groups, records, legacy, opaque: legacy.length > 0, errors };
}

function validateModel(model) {
  const errors = [...model.errors];
  if (!model.store) return errors;
  if (model.store.version !== '1') errors.push(issue('store', `不支持 memory 格式版本: ${model.store.version}`, { impact: 'fatal' }));
  if (!canonicalId(model.store.next_id)) errors.push(issue('store', 'next_id 必须使用四位最小 canonical 十进制表示', { impact: 'fatal' }));
  const ids = model.records.map((r) => r.id).filter(canonicalId);
  const next = canonicalId(model.store.next_id) ? BigInt(model.store.next_id) : null;
  if (next !== null && ids.some((id) => next <= BigInt(id))) errors.push(issue('store', 'next_id 必须严格高于所有已分配 ID', { impact: 'fatal' }));
  const groupIds = new Set();
  for (const group of model.groups) { if (groupIds.has(group.id)) errors.push(issue('group', `重复分组 ID: ${group.id}`, { impact: 'fatal' })); groupIds.add(group.id); }
  for (const record of model.records) if (record.group && !groupIds.has(record.group)) errors.push(issue('group', `记录 ${record.id} 引用未知分组`, { id: record.id, impact: 'fatal' }));
  return errors;
}

// A model containing un-migrated opaque text must never be re-serialized:
// writing would silently drop that content.
function writeErrors(model) {
  const errors = validateModel(model);
  if (model.opaque) errors.push(issue('legacy', '活动 memory.md 含未结构化内容；拒绝写入以原样保留', { impact: 'fatal' }));
  return errors;
}

function attributes(item, keys) { return keys.map((key) => `${key}="${escapeXml(item[key] ?? '')}"`).join(' '); }

function serialize(model) {
  let out = `<!-- <psm-store ${attributes(model.store, STORE_KEYS)} /> -->\n`;
  const emit = (record) => { out += `<!-- <psm ${attributes(record, RECORD_KEYS)} /> -->\n${record.content}\n\n`; };
  for (const record of model.records.filter((x) => !x.group)) emit(record);
  for (const group of model.groups) { out += `## ${group.title}\n<!-- <psm-group ${attributes(group, GROUP_KEYS)} /> -->\n\n`; for (const record of model.records.filter((x) => x.group === group.id)) emit(record); }
  return out;
}

/**
 * Guard for viewer/host-supplied record edits. Content that would manufacture
 * structural markers (psm tags, store tags, group tags) breaks every other
 * record on re-serialization, so it is rejected before any write is planned.
 */
function editGuard({ content, type, status }) {
  const errors = [];
  if (typeof content !== 'string' || !content.trim()) errors.push('正文必须是非空字符串');
  else if (/<!--\s*<\/?\s*(psm|psm-store|psm-group)[\s/>]/.test(content)) errors.push('正文不得包含 psm 结构标记');
  if (!TYPES.has(type)) errors.push(`非法类型: ${type}`);
  if (!STATUS.has(status)) errors.push(`非法状态: ${status}`);
  return errors;
}

/** Canonical timestamp shared by CLI and viewer (UTC, second precision). */
function timestamp() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

/**
 * Rule-based freshness estimate (mirror of memory-retrieval.mjs). It is an
 * estimate, not a verification verdict; the viewer labels it as such.
 * `nowMs` is injectable so tests can pin the clock.
 */
function ruleFreshness(record, nowMs) {
  if (record.type === 'decision' || record.type === 'constraint') return 1;
  const date = record.last_scored_at || record.created_at;
  const at = Date.parse(String(date || ''));
  if (!Number.isFinite(at)) return 0.5;
  const ageDays = Math.max(0, (nowMs - at) / 86400000);
  const halfLife = record.type === 'fact' ? 45 : 90;
  return Math.max(0, Math.min(1, Math.exp(-Math.LN2 * ageDays / halfLife)));
}

  return { TYPES, STATUS, TYPE_LABEL, RECORD_KEYS, STORE_KEYS, GROUP_KEYS, escapeXml, unescapeXml, parseElement, canonicalId, issue, parseStore, validateModel, writeErrors, serialize, editGuard, timestamp, ruleFreshness };
};

const lockFactory = (deps, fs, path) => {
/**
 * Locking and durable-write protection for memory.md.
 *
 * Lock order is always memory.lock → evidence.lock. Callers that already hold
 * memory.lock must never re-acquire it; nested acquisition deadlocks. The
 * lock file is held with `wx` create; a stale lock is only reclaimed when the
 * recorded owner process is confirmed dead, never by age alone.
 */


const MEMORY_LOCK_FILE = 'memory.lock';
const EVIDENCE_LOCK_FILE = 'evidence.lock';

function memoryPaths(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const base = path.join(root, '.project-self-memory');
  return {
    root,
    base,
    memory: path.join(base, 'memory.md'),
    ledger: path.join(base, 'evidence.jsonl'),
    lock: path.join(base, MEMORY_LOCK_FILE),
    evidenceLock: path.join(base, EVIDENCE_LOCK_FILE),
    backups: path.join(base, 'backups'),
  };
}

function ownerAlive(lockFile) {
  try {
    const meta = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (typeof meta.pid === 'number' && meta.pid > 0) {
      try { process.kill(meta.pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
    }
  } catch { /* unreadable or racing removal: owner unknown */ }
  return null; // unknown owner → do not delete
}

function tryAcquire(lockFile) {
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return false;
  }
}

function release(lockFile) {
  try { fs.unlinkSync(lockFile); } catch { /* already released */ }
}

function sleepSync(ms) {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, Math.max(1, ms));
}

/**
 * Synchronous acquisition for CLI use. Waits up to timeoutMs. A lock whose
 * recorded owner is confirmed dead is reclaimed; any other case times out.
 */
function acquireLockSync(lockFile, { timeoutMs = 15000 } = {}) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const started = Date.now();
  while (!tryAcquire(lockFile)) {
    if (Date.now() - started >= timeoutMs) throw Error(`${path.basename(lockFile)} 锁超时，拒绝写入`);
    if (ownerAlive(lockFile) === false) { try { fs.unlinkSync(lockFile); } catch { /* raced */ } continue; }
    sleepSync(50);
  }
  return { release: () => release(lockFile) };
}

/**
 * Non-blocking acquisition for HTTP use. Returns null when busy so the server
 * can answer 503 immediately instead of stalling the event loop.
 */
function tryAcquireLock(lockFile) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  if (!tryAcquire(lockFile)) return null;
  return { release: () => release(lockFile) };
}

/**
 * Acquire memory.lock then evidence.lock (the only legal order). Returns null
 * when either is busy; any lock already taken is released before returning.
 */
function tryAcquireStoreLocks(projectRoot) {
  const { lock, evidenceLock } = memoryPaths(projectRoot);
  const memory = tryAcquireLock(lock);
  if (!memory) return null;
  const evidence = tryAcquireLock(evidenceLock);
  if (!evidence) { memory.release(); return null; }
  return { release: () => { evidence.release(); memory.release(); } };
}

/** Blocking variant of tryAcquireStoreLocks for CLI paths. */
function acquireStoreLocksSync(projectRoot, options = {}) {
  const { lock, evidenceLock } = memoryPaths(projectRoot);
  const memory = acquireLockSync(lock, options);
  try {
    const evidence = acquireLockSync(evidenceLock, options);
    return { release: () => { evidence.release(); memory.release(); } };
  } catch (error) { memory.release(); throw error; }
}

function acquireMemoryLockSync(projectRoot, options = {}) {
  const { lock } = memoryPaths(projectRoot);
  return acquireLockSync(lock, options);
}

function tryAcquireMemoryLock(projectRoot) {
  const { lock } = memoryPaths(projectRoot);
  return tryAcquireLock(lock);
}

/** Raw-bytes backup before a durable replacement. Failure must abort the write. */
function backupMemoryFile(projectRoot, bytes) {
  const { memory, backups } = memoryPaths(projectRoot);
  fs.mkdirSync(backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..*$/, '');
  const name = `memory-${stamp}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.md`;
  const file = path.join(backups, name);
  fs.writeFileSync(file, bytes);
  // Read back to confirm the backup is intact before it may be trusted.
  if (!fs.readFileSync(file).equals(bytes)) throw Error(`备份校验失败: ${file}`);
  return { file, name, source: memory };
}

/**
 * Atomic same-directory replacement: write a temp file, fsync, rename.
 * The temp file is cleaned up on failure so a crash never leaves a torn file.
 */
function atomicReplace(targetFile, bytes) {
  const temp = `${targetFile}.psm-${process.pid}-${Date.now()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'w');
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(temp, targetFile);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* temp may not exist */ }
    throw error;
  }
}

  return { MEMORY_LOCK_FILE, EVIDENCE_LOCK_FILE, memoryPaths, acquireLockSync, tryAcquireLock, tryAcquireStoreLocks, acquireStoreLocksSync, acquireMemoryLockSync, tryAcquireMemoryLock, backupMemoryFile, atomicReplace };
};

const ledgerFactory = (deps, crypto, fs, path) => {
/**
 * Append-only, body-free evidence ledger for project-self-memory.
 *
 * The ledger deliberately lives outside memory.md.  memory.md remains the
 * human-curated source of record text while this file is the durable source
 * for score projections and provenance.
 */



const LEDGER_VERSION = 1;
const LEDGER_FILE = 'evidence.jsonl';
const LOCK_FILE = 'evidence.lock';

const EVENT_KINDS = new Set([
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
const EVENT_SOURCES = new Set(['manual', 'automatic', 'migration', 'system']);
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

function ledgerPaths(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const base = path.join(root, '.project-self-memory');
  return { root, base, ledger: path.join(base, LEDGER_FILE), lock: path.join(base, LOCK_FILE) };
}

function recordVersion(record) {
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

function parseLedger(text) {
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

function readLedger(projectRoot, { required = true } = {}) {
  const file = ledgerPaths(projectRoot).ledger;
  if (!fs.existsSync(file)) {
    if (required) throw Error('缺少 evidence ledger；先运行 init 或 evidence migrate');
    return { events: [], byId: new Map(), errors: [], missing: true };
  }
  return { ...parseLedger(fs.readFileSync(file, 'utf8')), missing: false };
}

function initializeLedger(projectRoot) {
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
      // 死锁回收：仅当锁内 pid 已死才删除；读不出 pid 或判活失败一律保留等待，
      // 不得仅凭锁文件年龄删除可能仍被活进程持有的锁（规格）。
      try {
        const pid = JSON.parse(fs.readFileSync(lock, 'utf8')).pid;
        if (Number.isSafeInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); } catch (killError) {
            if (killError.code === 'ESRCH') fs.unlinkSync(lock); // 进程已死：回收
            // EPERM 或其他：视为存活，继续等待
          }
        }
      } catch { /* 锁刚好被释放或内容不可读：本轮不删，继续等待 */ }
      if (Date.now() - started >= timeoutMs) throw Error('evidence ledger 锁超时，拒绝写入');
      sleep(15);
    }
  }
  try { return action(); } finally { try { fs.unlinkSync(lock); } catch { /* lock already released */ } }
}

function defaultEventId(input) {
  return `manual-${crypto.randomUUID()}`;
}

function appendEvent(projectRoot, input) {
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

function projectEvents(events, recordId, recordVersion) {
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

function projectRecord(projectRoot, record) {
  const ledger = readLedger(projectRoot);
  return { ...record, ...projectEvents(ledger.events, record.id, recordVersion(record)), record_version: recordVersion(record) };
}

function inspectLedger(projectRoot, filters = {}) {
  const ledger = readLedger(projectRoot);
  const events = ledger.events.filter((event) => (!filters.event_id || event.event_id === filters.event_id)
    && (!filters.record_id || event.record_id === String(filters.record_id))
    && (!filters.record_version || event.record_version === filters.record_version));
  return { schema_version: LEDGER_VERSION, path: ledgerPaths(projectRoot).ledger, count: events.length, events };
}

function validateLedger(projectRoot) {
  const ledger = readLedger(projectRoot);
  return { schema_version: LEDGER_VERSION, path: ledgerPaths(projectRoot).ledger, count: ledger.events.length, valid: true };
}

function migrateLegacyScores(projectRoot, records) {
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

  return { LEDGER_VERSION, LEDGER_FILE, LOCK_FILE, EVENT_KINDS, EVENT_SOURCES, ledgerPaths, recordVersion, parseLedger, readLedger, initializeLedger, appendEvent, projectEvents, projectRecord, inspectLedger, validateLedger, migrateLegacyScores };
};

const serverFactory = (deps) => {
/**
 * HTTP service factory for the compact memory viewer.
 *
 * The factory receives every dependency explicitly (the single-file builder
 * wires the same factory with inlined modules), captures no module-private
 * state and performs all writes through the shared store core + lock +
 * backup pipeline. It serves:
 *
 *   GET  /                    the compact page (no record data embedded)
 *   GET  /api/snapshot        full state snapshot + diagnostics
 *   PATCH /api/records/:id    restricted single-record update
 *
 * Security contract: loopback only, Host allowlist, bearer token for every
 * /api call (reads included), Origin check on writes, conservative whole-store
 * optimistic concurrency (store_revision), non-blocking lock acquisition
 * (503 when busy), strict JSON body limits.
 */
function createViewerServer(deps) {
  const { fs, path, crypto, http, store, lock, ledger } = deps;
  const { projectRoot, token, pageHtml } = deps;

  const paths = lock.memoryPaths(projectRoot);
  const MAX_BODY = 256 * 1024;
  const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const SCORE_KINDS = new Set([
    'human_positive', 'human_negative', 'applied_success', 'applied_failure',
    'still_valid', 'legacy_positive', 'legacy_negative',
  ]);

  const json = (res, status, payload) => {
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    res.end(bytes);
  };

  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

  /** store_revision: digest over raw bytes of memory.md + evidence.jsonl. */
  function storeRevision() {
    const memory = fs.existsSync(paths.memory) ? fs.readFileSync(paths.memory) : Buffer.alloc(0);
    const evidence = fs.existsSync(paths.ledger) ? fs.readFileSync(paths.ledger) : Buffer.alloc(0);
    return sha(Buffer.concat([memory, Buffer.from([0]), evidence]));
  }

  /** Full snapshot: records with current-version projections + diagnostics. */
  function buildSnapshot() {
    const diagnostics = [];
    let model = null;
    let ledgerEvents = [];
    if (!fs.existsSync(paths.memory)) {
      diagnostics.push({ kind: 'store', message: '缺少 memory.md；查看器只读，不会自动 init', impact: 'fatal' });
    } else {
      try {
        model = store.parseStore(fs.readFileSync(paths.memory, 'utf8'));
        diagnostics.push(...store.writeErrors(model));
      } catch (error) {
        diagnostics.push({ kind: 'store', message: error.message, impact: 'fatal' });
      }
    }
    try {
      ledgerEvents = ledger.readLedger(paths.root, { required: false }).events;
    } catch (error) {
      diagnostics.push({ kind: 'evidence', message: error.message, impact: 'fatal' });
    }
    const nowMs = Date.now();
    const records = [];
    if (model) {
      const invalid = new Set(diagnostics.filter((x) => x.kind === 'record').map((x) => x.id));
      for (const record of model.records) {
        if (invalid.has(record.id)) continue;
        const version = ledger.recordVersion(record);
        const projection = ledger.projectEvents(ledgerEvents, record.id, version);
        const scoreEvents = ledgerEvents.filter((event) => event.record_id === record.id
          && event.record_version === version && SCORE_KINDS.has(event.kind));
        records.push({
          id: record.id,
          type: record.type,
          status: record.status,
          group: record.group,
          content: record.content,
          created_at: record.created_at,
          record_version: version,
          positive: projection.positive,
          negative: projection.negative,
          last_scored_at: projection.last_scored_at,
          event_count: projection.event_count,
          score_event_count: scoreEvents.length,
          freshness: store.ruleFreshness(record, nowMs),
        });
      }
    }
    return {
      format: 'psm-viewer-snapshot-v1',
      store_revision: storeRevision(),
      read_only: diagnostics.some((x) => x.impact === 'fatal'),
      diagnostics,
      groups: model ? model.groups : [],
      group_dimension: model?.store?.group_dimension || '',
      generated_at: new Date(nowMs).toISOString(),
      records,
    };
  }

  function hostOk(req) {
    const host = String(req.headers.host || '');
    const name = host.replace(/:\d+$/, '');
    return ALLOWED_HOSTS.has(name) || ALLOWED_HOSTS.has(host);
  }

  function tokenOk(req) {
    const header = String(req.headers.authorization || '');
    return header === `Bearer ${token}`;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { reject(Object.assign(Error('请求体超限'), { code: 'TOO_LARGE' })); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  /** Restricted single-record update with optimistic whole-store concurrency. */
  async function patchRecord(req, res, id) {
    // Origin: cross-origin browser writes are refused; same-origin fetch sends
    // a matching Origin, non-browser clients may omit it.
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { originHost = ''; }
      if (originHost !== String(req.headers.host || '')) return json(res, 403, { error: 'ORIGIN_REJECTED', message: '拒绝跨源写入' });
    }
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
      return json(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE', message: '只接受 application/json' });
    }
    let body;
    try { body = await readBody(req); } catch (error) {
      return json(res, error.code === 'TOO_LARGE' ? 413 : 400, { error: 'BAD_BODY', message: error.message });
    }
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch {
      return json(res, 400, { error: 'BAD_JSON', message: '请求体不是合法 JSON' });
    }
    const allowed = new Set(['store_revision', 'content', 'type', 'status']);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some((key) => !allowed.has(key))) {
      return json(res, 400, { error: 'BAD_FIELDS', message: '只允许 store_revision、content、type、status 字段' });
    }
    const guardErrors = store.editGuard({ content: payload.content, type: payload.type, status: payload.status });
    if (typeof payload.store_revision !== 'string' || guardErrors.length) {
      return json(res, 400, { error: 'VALIDATION', message: guardErrors.join('；') || '缺少 store_revision' });
    }
    // Non-blocking lock: a busy store answers 503 immediately instead of
    // stalling the event loop behind a synchronous wait.
    const lease = lock.tryAcquireStoreLocks(paths.root);
    if (!lease) return json(res, 503, { error: 'LOCK_BUSY', message: 'memory.lock 或 evidence.lock 正被其他进程持有；稍后重试' });
    try {
      const currentRevision = storeRevision();
      if (currentRevision !== payload.store_revision) {
        return json(res, 409, { error: 'CONFLICT', message: '库已被外部修改；草稿保留在页面，可重新加载后重试', store_revision: currentRevision });
      }
      let model;
      try { model = store.parseStore(fs.readFileSync(paths.memory, 'utf8')); } catch (error) {
        return json(res, 422, { error: 'READ_ONLY', message: `库损坏，只读: ${error.message}` });
      }
      const writeErrors = store.writeErrors(model);
      try { ledger.validateLedger(paths.root); } catch (error) { writeErrors.push({ kind: 'evidence', message: error.message, impact: 'fatal' }); }
      if (writeErrors.length) {
        return json(res, 422, { error: 'READ_ONLY', message: `库损坏，只读: ${writeErrors.map((x) => x.message).join('；')}` });
      }
      const record = model.records.find((x) => x.id === id);
      if (!record) return json(res, 404, { error: 'NOT_FOUND', message: `不存在记录: ${id}` });
      record.content = payload.content.trim();
      record.type = payload.type;
      record.status = payload.status;
      // Sync compatibility projections exactly like the CLI does.
      const events = ledger.readLedger(paths.root).events;
      for (const item of model.records) {
        const projection = ledger.projectEvents(events, item.id, ledger.recordVersion(item));
        item.positive = projection.positive;
        item.negative = projection.negative;
        item.last_scored_at = projection.last_scored_at;
      }
      const bytes = Buffer.from(store.serialize(model), 'utf8');
      const onDisk = fs.readFileSync(paths.memory);
      if (onDisk.equals(bytes)) {
        return json(res, 200, { applied: false, unchanged: true, snapshot: buildSnapshot() });
      }
      // Full-model validation before anything touches disk.
      const reparsed = store.parseStore(bytes.toString('utf8'));
      const revalidate = store.writeErrors(reparsed);
      if (revalidate.length) {
        return json(res, 500, { error: 'SERIALIZE_GUARD', message: `序列化结果校验失败，未写入: ${revalidate.map((x) => x.message).join('；')}` });
      }
      let backup;
      try { backup = lock.backupMemoryFile(paths.root, onDisk); } catch (error) {
        return json(res, 500, { error: 'BACKUP_FAILED', message: `备份失败，未写入: ${error.message}` });
      }
      try { lock.atomicReplace(paths.memory, bytes); } catch (error) {
        return json(res, 500, { error: 'WRITE_FAILED', message: `写入失败: ${error.message}` });
      }
      return json(res, 200, { applied: true, backup: backup.file, snapshot: buildSnapshot() });
    } catch (error) {
      return json(res, 500, { error: 'IO_FAILED', message: error.message });
    } finally {
      lease.release();
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!hostOk(req)) return json(res, 403, { error: 'HOST_REJECTED', message: '仅接受回环 Host' });
    if (url.pathname === '/' && req.method === 'GET') {
      const bytes = Buffer.from(pageHtml, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      });
      res.end(bytes);
      return;
    }
    if (url.pathname === '/api/snapshot' && req.method === 'GET') {
      if (!tokenOk(req)) return json(res, 401, { error: 'UNAUTHORIZED', message: '缺少或错误的访问令牌；请使用本次启动输出的地址' });
      try { return json(res, 200, buildSnapshot()); } catch (error) { return json(res, 500, { error: 'IO_FAILED', message: error.message }); }
    }
    const patchMatch = url.pathname.match(/^\/api\/records\/(\d{4}|[1-9]\d{4,})$/);
    if (patchMatch && req.method === 'PATCH') {
      if (!tokenOk(req)) return json(res, 401, { error: 'UNAUTHORIZED', message: '缺少或错误的访问令牌；请使用本次启动输出的地址' });
      return patchRecord(req, res, patchMatch[1]).catch((error) => json(res, 500, { error: 'IO_FAILED', message: error.message }));
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'NOT_FOUND', message: '未知接口' });
    // No arbitrary file service: everything outside the page and the API 404s.
    return json(res, 404, { error: 'NOT_FOUND', message: '不存在该资源' });
  });

  return { server, paths, storeRevision, buildSnapshot };
}

  return { createViewerServer };
};

const pageFactory = (deps) => {
/**
 * Compact viewer page for project-self-memory.
 *
 * The page is a single HTML string. Record data is never embedded; the page
 * reads the access token from the launch URL fragment, keeps it in memory and
 * calls the authenticated API. All record text is rendered via textContent.
 * Page JS deliberately avoids backticks and the sequence "</script>" so the
 * builder can inline it without escaping surprises.
 */

const VIEWER_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>项目记忆查看器</title>
<style>
:root {
  --border: #c9cfd6; --bg: #ffffff; --bg-alt: #f5f6f8; --text: #1a1d21;
  --muted: #5b636d; --accent: #0b5cad; --danger: #b3261e; --ok: #146c2e;
  --type-experience: #e8f0fe; --type-pitfall: #fce8e6; --type-decision: #e6f4ea;
  --type-constraint: #fef7e0; --type-fact: #f3e8fd;
  --status-active: #e6f4ea; --status-review: #fef7e0; --status-disabled: #eceef1;
  --net-pos: #e6f4ea; --net-neg: #fce8e6; --net-zero: #f5f6f8;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text);
  font: 13px/1.45 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; }
body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
button, input, select, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 6px 12px; border-bottom: 1px solid var(--border); min-height: 38px;
  position: sticky; top: 0; background: var(--bg); z-index: 3; }
#toolbar label { color: var(--muted); white-space: nowrap; }
#toolbar input[type=search] { width: 180px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 3px; }
#toolbar select { padding: 3px 4px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg); }
#toolbar button { padding: 3px 10px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-alt); cursor: pointer; }
#toolbar button:hover { border-color: var(--accent); }
#main { display: flex; gap: 0; flex: 1; min-height: 0; }
#list { flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden; position: relative; }
#editor { width: 390px; flex: none; border-left: 1px solid var(--border);
  display: flex; flex-direction: column; background: var(--bg); }
#editor.hidden { display: none; }
.group-head { display: flex; align-items: center; gap: 6px; padding: 4px 12px;
  background: var(--bg-alt); border-bottom: 1px solid var(--border); cursor: pointer;
  font-weight: 600; height: 29px; user-select: none; }
.group-head .count { color: var(--muted); font-weight: 400; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; }
/* 固定列宽（table-layout: fixed 下同作用于 th/td），保证表头与内容纵向对齐 */
col.c-id { width: 56px; }
col.c-type { width: 70px; }
col.c-status { width: 70px; }
col.c-net { width: 72px; }
col.c-pos, col.c-neg { width: 44px; }
col.c-fresh { width: 64px; }
col.c-time { width: 150px; }
thead th { position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--border);
  text-align: left; padding: 4px 6px; font-weight: 600; white-space: nowrap; z-index: 2; }
thead th.num { text-align: right; }
tbody td { border-bottom: 1px solid var(--border); padding: 0 6px; height: 31px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
tbody tr { cursor: pointer; }
tbody tr:hover td { background: var(--bg-alt); }
tbody tr.selected td { background: #e8f0fe; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td .pill { display: inline-block; padding: 0 6px; border-radius: 3px; line-height: 20px;
  border: 1px solid rgba(0, 0, 0, 0.14); }
.c-type-experience { background: var(--type-experience); }
.c-type-pitfall { background: var(--type-pitfall); }
.c-type-decision { background: var(--type-decision); }
.c-type-constraint { background: var(--type-constraint); }
.c-type-fact { background: var(--type-fact); }
.c-status-active { background: var(--status-active); }
.c-status-review { background: var(--status-review); }
.c-status-disabled { background: var(--status-disabled); color: var(--muted); }
.c-net-pos { background: var(--net-pos); color: var(--ok); }
.c-net-neg { background: var(--net-neg); color: var(--danger); }
.c-net-zero { background: var(--net-zero); }
.unrated { color: var(--muted); font-style: normal; }
#editor-head { padding: 6px 10px; border-bottom: 1px solid var(--border); font-weight: 600; }
#editor-body { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; }
#editor-body textarea { width: 100%; min-height: 220px; resize: vertical; padding: 6px;
  border: 1px solid var(--border); border-radius: 3px; font-family: inherit; }
#editor-body .row { display: flex; gap: 6px; align-items: center; }
#editor-body .row label { width: 64px; color: var(--muted); flex: none; }
#editor-body select { flex: 1; padding: 3px 4px; border: 1px solid var(--border); border-radius: 3px; }
#editor-meta { font-size: 12px; color: var(--muted); display: grid;
  grid-template-columns: auto 1fr; gap: 2px 8px; word-break: break-all; }
#editor-foot { border-top: 1px solid var(--border); padding: 6px 10px; display: flex;
  gap: 6px; align-items: center; position: sticky; bottom: 0; background: var(--bg); }
#editor-foot button { padding: 4px 12px; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; }
#save-btn { background: var(--accent); border-color: var(--accent); color: #fff; }
#save-btn:disabled { background: var(--muted); border-color: var(--muted); cursor: default; }
#status-line { padding: 3px 12px; border-top: 1px solid var(--border); color: var(--muted); min-height: 24px; flex: none; }
#status-line.error { color: var(--danger); }
#status-line.conflict { color: var(--danger); font-weight: 600; }
#banner { display: none; padding: 8px 12px; background: #fef7e0; border-bottom: 1px solid var(--border); }
#banner.show { display: block; }
#empty { padding: 24px 12px; color: var(--muted); }
#mobile-toggle { display: none; }
@media (max-width: 767px) {
  #editor { position: fixed; inset: 0; width: auto; z-index: 5; }
  #mobile-toggle { display: inline-block; }
  .hide-narrow { display: none; }
  col.c-time { width: 104px; }
  tbody td, thead th { padding: 0 4px; }
  button, select, input { min-height: 32px; }
}
</style>
</head>
<body>
<div id="banner" role="alert"></div>
<div id="toolbar" role="toolbar" aria-label="筛选与视图控制">
  <label for="q">搜索</label><input id="q" type="search" placeholder="正文或 ID">
  <label for="f-type">类型</label><select id="f-type"><option value="">全部</option></select>
  <label for="f-status">状态</label><select id="f-status"><option value="">全部</option></select>
  <label for="f-group" class="hide-narrow">存储分组</label><select id="f-group" class="hide-narrow"><option value="">全部</option></select>
  <label for="f-evidence">评分</label><select id="f-evidence">
    <option value="">全部</option><option value="has">有证据</option>
    <option value="rated">已评分</option><option value="unrated">未评分</option></select>
  <label for="view-group">分组</label><select id="view-group">
    <option value="type">按类型</option><option value="">不分组</option>
    <option value="status">按状态</option><option value="group">按存储分组</option>
    <option value="month">按创建月份</option></select>
  <label for="sort-key">排序</label><select id="sort-key">
    <option value="created_at">创建时间</option><option value="id">ID</option>
    <option value="positive">正分</option><option value="negative">负分</option>
    <option value="net">净分</option><option value="freshness">新鲜度</option>
    <option value="length">正文长度</option></select>
  <button id="sort-dir" aria-label="切换升降序">降序 ↓</button>
  <label for="color-mode">上色</label><select id="color-mode">
    <option value="type">按类型</option><option value="status">按状态</option>
    <option value="net">按净分</option><option value="">不上色</option></select>
  <button id="reload">重新加载</button>
  <button id="mobile-toggle">列表 / 编辑</button>
</div>
<div id="main">
  <div id="list" role="region" aria-label="记忆列表"></div>
  <section id="editor" class="hidden" aria-label="编辑区">
    <div id="editor-head">编辑</div>
    <div id="editor-body">
      <div id="editor-meta"></div>
      <div class="row"><label for="e-type">类型</label><select id="e-type"></select></div>
      <div class="row"><label for="e-status">状态</label><select id="e-status"></select></div>
      <label for="e-content">正文</label>
      <textarea id="e-content" spellcheck="false"></textarea>
    </div>
    <div id="editor-foot">
      <button id="save-btn">保存 (Ctrl+S)</button>
      <button id="reset-btn">重置草稿</button>
      <span id="dirty-flag" aria-live="polite"></span>
    </div>
  </section>
</div>
<div id="status-line" role="status"></div>
<script>
(function () {
'use strict';
var TYPE_LABEL = { experience: '经验', pitfall: '避坑', decision: '决策', constraint: '约束', fact: '事实' };
var STATUS_LABEL = { active: '启用', review: '待复核', disabled: '停用' };
var TYPES = ['experience', 'pitfall', 'decision', 'constraint', 'fact'];
var STATUSES = ['active', 'review', 'disabled'];

// Token hand-off: the fragment never reaches the server or history. A
// fragment-only change does not reload the page, so the token is kept in
// sessionStorage (tab-scoped, cleared with the tab) and the fragment is
// removed immediately. A full reload without the stored token means the
// launch URL must be re-opened; the page never falls back to unauthenticated
// access.
var token = '';
try {
  if (location.hash.indexOf('#token=') === 0) {
    token = location.hash.slice(7);
    sessionStorage.setItem('psm-viewer-token', token);
  } else {
    token = sessionStorage.getItem('psm-viewer-token') || '';
  }
} catch (e) { /* storage may be unavailable; memory token still works */ }
if (location.hash.indexOf('#token=') === 0) {
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* best effort */ }
}

var state = {
  snapshot: null, records: [], groups: [], readOnly: false,
  q: '', fType: '', fStatus: '', fGroup: '', fEvidence: '',
  viewGroup: 'type', sortKey: 'created_at', sortDesc: true, colorMode: 'type',
  collapsed: {}, selectedId: null,
  edit: { status: 'clean', draft: null, baseline: null, message: '' },
};

var $ = function (id) { return document.getElementById(id); };
var els = {
  q: $('q'), fType: $('f-type'), fStatus: $('f-status'), fGroup: $('f-group'),
  fEvidence: $('f-evidence'), viewGroup: $('view-group'), sortKey: $('sort-key'),
  sortDir: $('sort-dir'), colorMode: $('color-mode'), reload: $('reload'),
  list: $('list'), editor: $('editor'), editorMeta: $('editor-meta'),
  eType: $('e-type'), eStatus: $('e-status'), eContent: $('e-content'),
  saveBtn: $('save-btn'), resetBtn: $('reset-btn'), dirtyFlag: $('dirty-flag'),
  statusLine: $('status-line'), banner: $('banner'), mobileToggle: $('mobile-toggle'),
};

function fillSelect(el, values, labels) {
  for (var i = 0; i < values.length; i++) {
    var o = document.createElement('option');
    o.value = values[i]; o.textContent = labels[values[i]] || values[i];
    el.appendChild(o);
  }
}
fillSelect(els.fType, TYPES, TYPE_LABEL);
fillSelect(els.fStatus, STATUSES, STATUS_LABEL);
fillSelect(els.eType, TYPES, TYPE_LABEL);
fillSelect(els.eStatus, STATUSES, STATUS_LABEL);

function setStatus(text, kind) {
  els.statusLine.textContent = text || '';
  els.statusLine.className = kind || '';
}
function showBanner(text) {
  els.banner.textContent = text || '';
  els.banner.className = text ? 'show' : '';
}

function api(pathname, options) {
  options = options || {};
  options.headers = Object.assign({ Authorization: 'Bearer ' + token }, options.headers || {});
  return fetch(pathname, options).then(function (res) {
    return res.json().then(function (body) {
      return { status: res.status, body: body };
    });
  });
}

function load() {
  if (!token) {
    showBanner('页面令牌已丢失（刷新或手动输入地址所致）。请从本次启动输出的地址重新打开。');
    setStatus('未认证', 'error');
    return;
  }
  setStatus('加载中…');
  api('/api/snapshot').then(function (r) {
    if (r.status === 401) {
      showBanner('访问令牌错误。请使用本次启动输出的完整地址。');
      setStatus('未认证', 'error');
      return;
    }
    if (r.status !== 200) { setStatus('加载失败: ' + (r.body.message || r.status), 'error'); return; }
    state.snapshot = r.body;
    state.records = r.body.records || [];
    state.groups = r.body.groups || [];
    state.readOnly = !!r.body.read_only;
    if (state.readOnly) {
      var msgs = (r.body.diagnostics || []).map(function (d) { return d.message; });
      showBanner('库损坏或格式不支持，只读诊断模式：' + msgs.join('；'));
    } else {
      showBanner('');
    }
    rebuildGroupFilter();
    render();
    var msg = '共 ' + state.records.length + ' 条 · 修订 ' + r.body.store_revision.slice(0, 8);
    if (state.readOnly) msg += ' · 只读';
    setStatus(msg);
    if (state.selectedId && !findRecord(state.selectedId)) closeEditor();
    else if (state.selectedId) refreshEditorBaseline();
  }).catch(function (e) { setStatus('加载失败: ' + e.message, 'error'); });
}

function rebuildGroupFilter() {
  var current = els.fGroup.value;
  while (els.fGroup.options.length > 1) els.fGroup.remove(1);
  for (var i = 0; i < state.groups.length; i++) {
    var o = document.createElement('option');
    o.value = state.groups[i].id;
    o.textContent = state.groups[i].title + ' (' + state.groups[i].id + ')';
    els.fGroup.appendChild(o);
  }
  els.fGroup.value = current;
}

function findRecord(id) {
  for (var i = 0; i < state.records.length; i++) if (state.records[i].id === id) return state.records[i];
  return null;
}

function codePoints(s) { var n = 0; for (var c of s) n++; return n; }

function netScore(r) { return r.positive - r.negative; }

function monthKey(iso) { return String(iso || '').slice(0, 7) || '未知'; }

function filtered() {
  var q = state.q.trim().toLowerCase();
  return state.records.filter(function (r) {
    if (state.fType && r.type !== state.fType) return false;
    if (state.fStatus && r.status !== state.fStatus) return false;
    if (state.fGroup && r.group !== state.fGroup) return false;
    if (state.fEvidence === 'has' && !(r.event_count > 0)) return false;
    if (state.fEvidence === 'rated' && !(r.score_event_count > 0)) return false;
    if (state.fEvidence === 'unrated' && !(r.score_event_count === 0)) return false;
    if (q && r.id.indexOf(q) < 0 && r.content.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
}

function compareIds(a, b) {
  // Numeric comparison safe beyond the 2^53 limit: compare by length then lexically.
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : (a > b ? 1 : 0);
}

function sortRecords(list) {
  var key = state.sortKey, dir = state.sortDesc ? -1 : 1;
  var val = function (r) {
    if (key === 'net') return netScore(r);
    if (key === 'length') return codePoints(r.content);
    if (key === 'created_at') return r.created_at || '';
    return r[key];
  };
  return list.slice().sort(function (a, b) {
    var va = val(a), vb = val(b), c = 0;
    if (typeof va === 'number' && typeof vb === 'number') c = va - vb;
    else c = va < vb ? -1 : (va > vb ? 1 : 0);
    if (c === 0) c = compareIds(a.id, b.id); // stable secondary order
    return c * dir;
  });
}

function groupKey(r) {
  if (state.viewGroup === 'type') return 'type:' + r.type;
  if (state.viewGroup === 'status') return 'status:' + r.status;
  if (state.viewGroup === 'group') return 'group:' + (r.group || '');
  if (state.viewGroup === 'month') return 'month:' + monthKey(r.created_at);
  return '';
}
function groupTitle(key) {
  if (!key) return '';
  var p = key.split(':'), kind = p[0], v = p.slice(1).join(':');
  if (kind === 'type') return TYPE_LABEL[v] || v;
  if (kind === 'status') return STATUS_LABEL[v] || v;
  if (kind === 'group') {
    if (!v) return '未分组';
    for (var i = 0; i < state.groups.length; i++) if (state.groups[i].id === v) return state.groups[i].title;
    return v;
  }
  if (kind === 'month') return v + ' (UTC)';
  return key;
}
function groupOrder(key) {
  var order = { type: TYPES, status: STATUSES };
  var kind = key.split(':')[0], v = key.slice(kind.length + 1);
  if (order[kind]) { var i = order[kind].indexOf(v); return (i < 0 ? 99 : i) + ''; }
  if (kind === 'month') return v;
  return v;
}

function pill(cls, text) {
  var s = document.createElement('span');
  s.className = 'pill ' + cls; s.textContent = text;
  return s;
}

function netCell(r) {
  var td = document.createElement('td'); td.className = 'num';
  if (r.score_event_count === 0) {
    var s = document.createElement('span'); s.className = 'unrated'; s.textContent = '未评分';
    td.appendChild(s);
    if (r.event_count > 0) {
      // 仅有谱系等非评分事件时同时显示「有证据」，与评分事件数明确区分（规格）
      var ev = document.createElement('span'); ev.className = 'unrated';
      ev.textContent = ' · 有证据'; ev.title = '当前版本有 ' + r.event_count + ' 条非评分事件';
      td.appendChild(ev);
    }
  } else {
    var net = netScore(r);
    var cls = net > 0 ? 'c-net-pos' : (net < 0 ? 'c-net-neg' : 'c-net-zero');
    td.appendChild(pill(cls, (net > 0 ? '+' : '') + net));
  }
  return td;
}

function render() {
  els.list.textContent = '';
  var list = sortRecords(filtered());
  if (!list.length) {
    var d = document.createElement('div'); d.id = 'empty';
    d.textContent = state.records.length ? '无符合筛选条件的记录' : '库中没有记录';
    els.list.appendChild(d); return;
  }
  var groups = {};
  var order = [];
  for (var i = 0; i < list.length; i++) {
    var k = groupKey(list[i]);
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(list[i]);
  }
  if (state.viewGroup) {
    order.sort(function (a, b) {
      var ga = groupOrder(a), gb = groupOrder(b);
      if (state.viewGroup === 'month') return ga < gb ? 1 : (ga > gb ? -1 : 0);
      return ga < gb ? -1 : (ga > gb ? 1 : 0);
    });
  }
  for (var gi = 0; gi < order.length; gi++) {
    var key = order[gi], recs = groups[key];
    if (state.viewGroup) {
      var head = document.createElement('div');
      head.className = 'group-head'; head.setAttribute('role', 'button');
      head.tabIndex = 0;
      var isCollapsed = !!state.collapsed[key];
      head.textContent = (isCollapsed ? '▸ ' : '▾ ') + groupTitle(key) + ' ';
      var cnt = document.createElement('span'); cnt.className = 'count';
      cnt.textContent = recs.length + ' 条';
      head.appendChild(cnt);
      head.addEventListener('click', toggleGroup(key));
      head.addEventListener('keydown', groupKeydown(key));
      els.list.appendChild(head);
      if (isCollapsed) continue;
    }
    els.list.appendChild(buildTable(recs));
  }
}
function toggleGroup(key) {
  return function () { state.collapsed[key] = !state.collapsed[key]; render(); };
}
function groupKeydown(key) {
  return function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.collapsed[key] = !state.collapsed[key]; render(); }
  };
}

function buildTable(recs) {
  var table = document.createElement('table');
  var cg = document.createElement('colgroup');
  ['c-id', 'c-type', 'c-status', 'c-net hide-narrow', 'c-pos hide-narrow',
   'c-neg hide-narrow', 'c-fresh hide-narrow', 'c-time', 'c-body'].forEach(function (cls) {
    var col = document.createElement('col');
    cls.split(' ').forEach(function (c) { col.classList.add(c); });
    cg.appendChild(col);
  });
  table.appendChild(cg);
  var thead = document.createElement('thead');
  var hr = document.createElement('tr');
  ['ID', '类型', '状态', '净分', '正', '负', '新鲜度', '创建时间', '正文'].forEach(function (h, i) {
    var th = document.createElement('th'); th.textContent = h;
    if (i >= 3 && i <= 6) th.className = 'num hide-narrow';
    hr.appendChild(th);
  });
  thead.appendChild(hr); table.appendChild(thead);
  var tb = document.createElement('tbody');
  for (var i = 0; i < recs.length; i++) tb.appendChild(buildRow(recs[i]));
  table.appendChild(tb);
  return table;
}

function buildRow(r) {
  var tr = document.createElement('tr');
  if (r.id === state.selectedId) tr.className = 'selected';
  tr.addEventListener('click', function () { selectRecord(r.id); });
  var cells = [];
  var idTd = document.createElement('td'); idTd.textContent = r.id; cells.push(idTd);
  var typeTd = document.createElement('td');
  var statusTd = document.createElement('td');
  if (state.colorMode === 'type') {
    typeTd.appendChild(pill('c-type-' + r.type, TYPE_LABEL[r.type] || r.type));
    statusTd.textContent = STATUS_LABEL[r.status] || r.status;
  } else if (state.colorMode === 'status') {
    typeTd.textContent = TYPE_LABEL[r.type] || r.type;
    statusTd.appendChild(pill('c-status-' + r.status, STATUS_LABEL[r.status] || r.status));
  } else {
    typeTd.textContent = TYPE_LABEL[r.type] || r.type;
    statusTd.textContent = STATUS_LABEL[r.status] || r.status;
  }
  cells.push(typeTd); cells.push(statusTd);
  var net = netCell(r); net.classList.add('hide-narrow'); cells.push(net);
  var pos = document.createElement('td'); pos.className = 'num hide-narrow';
  pos.textContent = r.score_event_count === 0 ? '—' : String(r.positive); cells.push(pos);
  var neg = document.createElement('td'); neg.className = 'num hide-narrow';
  neg.textContent = r.score_event_count === 0 ? '—' : String(r.negative); cells.push(neg);
  var fresh = document.createElement('td'); fresh.className = 'num hide-narrow';
  fresh.textContent = r.freshness.toFixed(2);
  fresh.title = '规则估算的新鲜度（按类型半衰期），不代表内容已验证'; cells.push(fresh);
  var time = document.createElement('td'); time.textContent = (r.created_at || '').replace('T', ' ').replace('Z', ''); cells.push(time);
  var body = document.createElement('td'); body.textContent = r.content.replace(/\\s+/g, ' ');
  cells.push(body);
  if (state.colorMode === 'net') {
    var n = netScore(r);
    if (r.score_event_count > 0) tr.style.background = n > 0 ? 'var(--net-pos)' : (n < 0 ? 'var(--net-neg)' : 'var(--net-zero)');
  }
  for (var i = 0; i < cells.length; i++) tr.appendChild(cells[i]);
  return tr;
}

function selectRecord(id) {
  if (state.edit.status === 'dirty' && state.selectedId && state.selectedId !== id) {
    if (!confirm('当前记录有未保存修改，切换将丢弃草稿。继续？')) return;
  }
  state.selectedId = id;
  openEditor();
  render();
}

function openEditor() {
  var r = findRecord(state.selectedId);
  if (!r) { closeEditor(); return; }
  els.editor.classList.remove('hidden');
  state.edit.status = 'clean';
  state.edit.draft = { content: r.content, type: r.type, status: r.status };
  state.edit.baseline = { content: r.content, type: r.type, status: r.status };
  renderEditor(r);
}
function closeEditor() {
  state.selectedId = null;
  state.edit = { status: 'clean', draft: null, baseline: null, message: '' };
  els.editor.classList.add('hidden');
}
function refreshEditorBaseline() {
  var r = findRecord(state.selectedId);
  if (!r || !state.edit.draft) return;
  if (state.edit.status === 'clean') {
    state.edit.draft = { content: r.content, type: r.type, status: r.status };
    state.edit.baseline = { content: r.content, type: r.type, status: r.status };
    renderEditor(r);
  }
  // dirty/conflict: never overwrite the user's draft silently.
}

function renderEditor(r) {
  var meta = els.editorMeta; meta.textContent = '';
  var pairs = [
    ['ID', r.id],
    ['创建时间', r.created_at],
    ['版本', r.record_version.slice(0, 12) + '…'],
    ['评分', r.score_event_count === 0 ? '未评分' : ('+' + r.positive + ' / -' + r.negative + '（净 ' + netScore(r) + '）')],
    ['证据事件', String(r.event_count)],
    ['最后评分', r.last_scored_at || '—'],
  ];
  for (var i = 0; i < pairs.length; i++) {
    var dt = document.createElement('div'); dt.textContent = pairs[i][0];
    var dd = document.createElement('div'); dd.textContent = pairs[i][1];
    meta.appendChild(dt); meta.appendChild(dd);
  }
  els.eContent.value = state.edit.draft.content;
  els.eType.value = state.edit.draft.type;
  els.eStatus.value = state.edit.draft.status;
  els.eContent.disabled = state.readOnly || state.edit.status === 'saving';
  els.eType.disabled = els.eContent.disabled;
  els.eStatus.disabled = els.eContent.disabled;
  updateDirtyFlag();
}

function updateDirtyFlag() {
  var d = state.edit.draft, b = state.edit.baseline;
  var dirty = d && b && (d.content !== b.content || d.type !== b.type || d.status !== b.status);
  if (dirty && state.edit.status === 'clean') state.edit.status = 'dirty';
  if (!dirty && state.edit.status === 'dirty') state.edit.status = 'clean';
  els.dirtyFlag.textContent = state.edit.status === 'dirty' ? '未保存' :
    state.edit.status === 'saving' ? '保存中…' :
    state.edit.status === 'saved' ? '已保存' :
    state.edit.status === 'conflict' ? '冲突' : '';
  els.saveBtn.disabled = state.readOnly || state.edit.status === 'saving' || state.edit.status === 'clean';
}

function markDraft() {
  if (!state.edit.draft) return;
  state.edit.draft.content = els.eContent.value;
  state.edit.draft.type = els.eType.value;
  state.edit.draft.status = els.eStatus.value;
  updateDirtyFlag();
}

function save() {
  if (!state.selectedId || !state.edit.draft) return;
  if (state.edit.status === 'saving') return;
  if (state.readOnly) { setStatus('库为只读，无法保存', 'error'); return; }
  var draft = Object.assign({}, state.edit.draft);
  var recordId = state.selectedId;
  state.edit.status = 'saving';
  updateDirtyFlag();
  setStatus('保存中…');
  api('/api/records/' + recordId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      store_revision: state.snapshot.store_revision,
      content: draft.content, type: draft.type, status: draft.status,
    }),
  }).then(function (r) {
    if (r.status === 200) {
      state.snapshot = r.body.snapshot;
      state.records = r.body.snapshot.records || [];
      if (r.body.applied) {
        state.edit.status = 'saved';
        state.edit.baseline = draft;
        setStatus('已保存' + (r.body.backup ? ' · 备份: ' + r.body.backup : ''));
      } else {
        state.edit.status = 'clean';
        state.edit.baseline = draft;
        setStatus('无实际变化，未写入');
      }
      render(); renderEditor(findRecord(recordId));
      return;
    }
    if (r.status === 409) {
      state.edit.status = 'conflict';
      setStatus('冲突：' + (r.body.message || '库已被外部修改') + '。草稿已保留；点击「重新加载」获取最新内容，草稿可用 Ctrl+C 从编辑框复制。', 'conflict');
      updateDirtyFlag();
      return;
    }
    if (r.status === 503) {
      state.edit.status = 'dirty';
      setStatus('存储正被其他进程写入（锁忙），请稍后重试。草稿已保留。', 'error');
      updateDirtyFlag();
      return;
    }
    state.edit.status = 'error';
    setStatus('保存失败：' + (r.body.message || ('HTTP ' + r.status)) + '。草稿已保留。', 'error');
    updateDirtyFlag();
  }).catch(function (e) {
    state.edit.status = 'error';
    setStatus('保存失败：' + e.message + '。草稿已保留。', 'error');
    updateDirtyFlag();
  });
}

els.q.addEventListener('input', function () { state.q = els.q.value; render(); });
els.fType.addEventListener('change', function () { state.fType = els.fType.value; render(); });
els.fStatus.addEventListener('change', function () { state.fStatus = els.fStatus.value; render(); });
els.fGroup.addEventListener('change', function () { state.fGroup = els.fGroup.value; render(); });
els.fEvidence.addEventListener('change', function () { state.fEvidence = els.fEvidence.value; render(); });
els.viewGroup.addEventListener('change', function () { state.viewGroup = els.viewGroup.value; render(); });
els.sortKey.addEventListener('change', function () { state.sortKey = els.sortKey.value; render(); });
els.sortDir.addEventListener('click', function () {
  state.sortDesc = !state.sortDesc;
  els.sortDir.textContent = state.sortDesc ? '降序 ↓' : '升序 ↑';
  render();
});
els.colorMode.addEventListener('change', function () { state.colorMode = els.colorMode.value; render(); });
els.reload.addEventListener('click', load);
els.eContent.addEventListener('input', markDraft);
els.eType.addEventListener('change', markDraft);
els.eStatus.addEventListener('change', markDraft);
els.saveBtn.addEventListener('click', save);
els.resetBtn.addEventListener('click', function () {
  if (state.edit.baseline) {
    state.edit.draft = Object.assign({}, state.edit.baseline);
    state.edit.status = 'clean';
    renderEditor(findRecord(state.selectedId));
  }
});
els.mobileToggle.addEventListener('click', function () {
  els.editor.classList.toggle('hidden');
});
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', function (e) {
  if (state.edit.status === 'dirty' || state.edit.status === 'saving') {
    e.preventDefault(); e.returnValue = '';
  }
});

load();
})();
</script>
</body>
</html>
`;

  return { VIEWER_PAGE_HTML };
};

const store = storeFactory({});
const lock = lockFactory({}, fs, path);
const ledger = ledgerFactory({}, crypto, fs, path);
const server = serverFactory({});
const page = pageFactory({});

const argv = process.argv.slice(2);
const portFlag = argv.indexOf('--port');
const port = portFlag >= 0 ? Number(argv[portFlag + 1]) : 0;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PSM_VIEWER_ERROR: --port 必须是 0..65535 的整数');
  process.exit(1);
}

// Memory directory is pinned next to THIS script; arbitrary paths are refused.
// 不用 require.resolve：ESM 宿主没有 require。
const scriptDir = path.dirname(path.resolve(process.argv[1] || '.'));
const projectRoot = scriptDir;
const token = crypto.randomBytes(32).toString('hex');
const { server: httpServer } = server.createViewerServer({
  fs, path, crypto, http, store, lock, ledger,
  projectRoot, token, pageHtml: page.VIEWER_PAGE_HTML,
});
httpServer.listen(port, '127.0.0.1', () => {
  const address = httpServer.address();
  const url = 'http://127.0.0.1:' + address.port + '/#token=' + token;
  console.log('PSM_VIEWER_URL: ' + url);
  console.log('记忆目录: ' + path.join(scriptDir, '.project-self-memory'));
  console.log('只监听本机回环；停止服务请按 Ctrl+C。');
});
})().catch((error) => {
  console.error('PSM_VIEWER_ERROR: ' + error.message);
  process.exit(1);
});
