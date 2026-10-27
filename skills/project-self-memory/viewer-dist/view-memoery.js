#!/usr/bin/env node
/*
 * view-memoery.js — project-self-memory 紧凑查看器（自包含单文件产物）。
 *
 * 由 skills/project-self-memory/scripts/build-viewer.mjs 生成。
 * 重新生成：node scripts/build-viewer.mjs
 * 一致性校验（不写文件）：node scripts/build-viewer.mjs --check
 *
 * 运行要求：Node 22+（以 Node 24 验证）。无第三方依赖；不访问网络；
 * 只监听 127.0.0.1；记忆目录固定为脚本所在目录内最近一层的
 * .project-self-memory/（项目根与 .project-self-memory/ 内启动均可）。
 *
 * 用法：
 *   node view-memoery.js [--port N] [--no-open]
 *   node .project-self-memory/view-memoery.js [--port N] [--no-open]
 * 输出：带 #token= 的访问地址。令牌只在进程与页面内存中，不写入磁盘。
 * 默认用系统默认浏览器打开该地址；--no-open 或 PSM_VIEWER_OPEN=0 禁止，
 * PSM_VIEWER_OPEN=echo 只打印打开地址（无头环境与测试诊断用）。
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
 * New content additionally goes through the single-line contract; unchanged
 * bodies are exempted by the caller (patchRecord) before reaching here.
 */
function editGuard({ content, type, status }) {
  const errors = [];
  if (typeof content !== 'string' || !content.trim()) errors.push('正文必须是非空字符串');
  else if (/<!--\s*<\/?\s*(psm|psm-store|psm-group)[\s/>]/.test(content)) errors.push('正文不得包含 psm 结构标记');
  if (!TYPES.has(type)) errors.push(`非法类型: ${type}`);
  if (!STATUS.has(status)) errors.push(`非法状态: ${status}`);
  return errors;
}

/**
 * Deterministic single-line body contract for newly written content.
 *
 * Applies to every entry point that supplies NEW record text (CLI add/update/
 * merge, legacy migrate, MemorySession auto-save, viewer PATCH). Historical
 * multiline records stay readable; they are only re-checked when their content
 * actually changes. The contract covers structural constraints only — meaning,
 * voice and one-fact-per-sentence remain host responsibilities, not CLI claims.
 *
 * Stripping rule: surrounding whitespace including a single trailing newline
 * of a text file is removed first; any interior line break (LF, CRLF, CR,
 * U+2028, U+2029) is then rejected. Headings, list markers and code fences at
 * the start are rejected because they are multiline Markdown templates, not
 * single-line conclusions.
 */
function contentContractErrors(content) {
  if (typeof content !== 'string') return ['正文必须是字符串'];
  const text = content.trim();
  if (!text) return ['正文必须是非空字符串'];
  if (/[\r\n\u2028\u2029]/.test(text)) return ['新正文必须单行：去除首尾空白后不得含内部换行（含 CRLF 与 Unicode 行/段分隔符）'];
  if (/<!--\s*<\/?\s*(psm|psm-store|psm-group)[\s/>]/.test(text)) return ['正文不得包含 psm 结构标记'];
  if (/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|```|~~~)/.test(text)) return ['新正文不得以 Markdown 标题、列表或代码围栏开头（单行存储要求）'];
  return [];
}

/** Shared single-line gate: throws with the deterministic reasons on failure. */
function assertContentContract(content) {
  const errors = contentContractErrors(content);
  if (errors.length) throw Error(`PSM_CONTRACT: 新正文不符合单行契约 — ${errors.join('；')}`);
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

  return { TYPES, STATUS, TYPE_LABEL, RECORD_KEYS, STORE_KEYS, GROUP_KEYS, escapeXml, unescapeXml, parseElement, canonicalId, issue, parseStore, validateModel, writeErrors, serialize, editGuard, contentContractErrors, assertContentContract, timestamp, ruleFreshness };
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

const tagsFactory = (deps, fs, path) => {
/** Optional, derived topic metadata. Never changes memory.md or evidence versions. */


const TAG_LIMIT = 8;
const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]*(:[a-z0-9][a-z0-9_.-]*)?$/;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function keys(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw Error(`${label} 含未知字段或不是对象`);
}
function tagList(value = []) {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string' || tag.length > 128 || !TAG_PATTERN.test(tag))) throw Error('标签必须是小写 name 或 key:value');
  return [...new Set(value)];
}
function literals(value = []) {
  if (!Array.isArray(value) || value.length > 64 || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 128)) throw Error('关键词必须是非空字面量数组，每项最多 128 字符');
  return [...new Set(value.map((item) => item.trim()))];
}

function normaliseTaxonomy(value = { version: 1, tags: [], overrides: {} }) {
  keys(value, ['version', 'tags', 'overrides'], '分类标准');
  if (value.version !== 1 || !Array.isArray(value.tags) || value.tags.length > 256) throw Error('分类标准要求 version=1 和最多 256 项 tags');
  const seen = new Set();
  const tags = value.tags.map((rule) => {
    keys(rule, ['name', 'any', 'all'], '标签规则');
    const [name] = tagList([rule.name]);
    if (seen.has(name)) throw Error(`重复标签: ${name}`);
    seen.add(name);
    return { name, any: literals(rule.any), all: literals(rule.all) };
  });
  const overrides = {};
  keys(value.overrides ?? {}, Object.keys(value.overrides ?? {}), 'overrides');
  if (Object.keys(value.overrides ?? {}).length > 100000) throw Error('overrides 超过上限');
  for (const [id, override] of Object.entries(value.overrides ?? {})) {
    if (!/^(?:\d{4}|[1-9]\d{4,})$/.test(id)) throw Error(`非法记录 ID: ${id}`);
    keys(override, ['add', 'remove'], 'override');
    const add = tagList(override.add); const remove = tagList(override.remove);
    if (add.length > TAG_LIMIT || remove.length > 256) throw Error('override 标签数量超过上限');
    overrides[id] = { add, remove };
  }
  return { version: 1, tags, overrides };
}

function deriveTags(record, taxonomy = normaliseTaxonomy()) {
  const content = String(record.content || '');
  const candidates = new Set();
  for (const match of content.matchAll(/^\s*\[([a-z0-9][a-z0-9_-]*)=([a-z0-9][a-z0-9_.,-]*)\]/gm)) {
    for (const value of match[2].split(',')) {
      const tag = `${match[1]}:${value}`;
      if (tag.length <= 128 && TAG_PATTERN.test(tag)) candidates.add(tag);
    }
  }
  const lower = content.toLowerCase();
  for (const rule of taxonomy.tags) {
    if ((rule.any.length || rule.all.length)
      && (!rule.any.length || rule.any.some((word) => lower.includes(word.toLowerCase())))
      && rule.all.every((word) => lower.includes(word.toLowerCase()))) candidates.add(rule.name);
  }
  const override = Object.hasOwn(taxonomy.overrides, record.id) ? taxonomy.overrides[record.id] : { add: [], remove: [] };
  for (const tag of override.add) candidates.add(tag);
  for (const tag of override.remove) candidates.delete(tag);
  // Explicit additions take precedence over the eight-tag cap; display order
  // remains taxonomy declaration order, then lexical for unregistered tags.
  const priority = [...override.add, ...candidates].filter((tag) => candidates.has(tag));
  const selected = new Set([...new Set(priority)].slice(0, TAG_LIMIT));
  const order = new Map(taxonomy.tags.map((rule, index) => [rule.name, index]));
  return [...selected].sort((a, b) => (order.get(a) ?? 1000000) - (order.get(b) ?? 1000000) || a.localeCompare(b, 'en'));
}

function loadTagTaxonomy(projectRoot) {
  const file = path.join(projectRoot, '.project-self-memory', 'tags.json');
  try {
    const stat = fs.statSync(file);
    if (stat.size > 1024 * 1024) throw Error('tags.json 超过 1 MiB');
    const text = fs.readFileSync(file, 'utf8');
    return { taxonomy: text.trim() ? normaliseTaxonomy(JSON.parse(text)) : normaliseTaxonomy(), diagnostics: [], enabled: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { taxonomy: normaliseTaxonomy(), diagnostics: [], enabled: true };
    return { taxonomy: normaliseTaxonomy(), enabled: false, diagnostics: [{ kind: 'tags', message: `标签降级: ${error.message}`, impact: 'warning' }] };
  }
}

function tagRecords(records, loaded) {
  return records.map((record) => ({ ...record, tags: loaded.enabled ? deriveTags(record, loaded.taxonomy) : [] }));
}

/** Conservative suggestions: existing prefixes and recurring identifier tokens. */
function suggestTaxonomy(records, loaded = { taxonomy: normaliseTaxonomy(), enabled: true }) {
  const counts = new Map();
  const existing = loaded.enabled ? loaded.taxonomy : normaliseTaxonomy();
  const prefixRules = new Map(existing.tags.map((rule) => [rule.name, rule]));
  for (const record of records) {
    for (const tag of deriveTags(record)) if (!prefixRules.has(tag)) prefixRules.set(tag, { name: tag, any: [], all: [] });
    const terms = new Set(String(record.content || '').toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []);
    for (const term of terms) counts.set(term, (counts.get(term) || 0) + 1);
  }
  const stop = new Set(['the', 'and', 'true', 'false', 'null', 'node', 'root', 'http', 'https', 'host_scope']);
  const candidates = [...counts].filter(([word, count]) => count >= 2 && !stop.has(word) && TAG_PATTERN.test(word))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')).slice(0, 32)
    .map(([word, count]) => ({ term: word, record_count: count }));
  const proposed = [...prefixRules.values()];
  const taxonomy = normaliseTaxonomy({ version: 1, tags: proposed.slice(0, 256), overrides: existing.overrides });
  const projected = tagRecords(records, { taxonomy, enabled: true });
  return { taxonomy, candidates, truncated_tags: Math.max(0, proposed.length - 256), total_records: records.length, covered_records: projected.filter((record) => record.tags.length).length,
    uncovered_ids: projected.filter((record) => !record.tags.length).map((record) => record.id) };
}

  return { TAG_LIMIT, TAG_PATTERN, normaliseTaxonomy, deriveTags, loadTagTaxonomy, tagRecords, suggestTaxonomy };
};

const cacheFactory = (deps, crypto, fs, path) => {
  const { TYPES } = deps;
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




const CACHE_FILE = 'cache.jsonl';
const CACHE_LOCK_FILE = 'cache.lock';
const CACHE_VERSION = 1;

/** The five candidate operations a cache entry may describe. */
const CACHE_OPS = new Set(['add', 'update', 'delete', '+1', '-1']);
/** Persistent entry states. `stale` is derived at read time, never stored. */
const CACHE_STATUSES = new Set(['pending', 'applied', 'discarded']);
const ENTRY_KEYS = new Set([
  'event_id', 'type', 'target_refid', 'target_record_version', 'base_content',
  'payload', 'evidence', 'source', 'created_at', 'processed_at', 'status',
]);
const EVIDENCE_KEYS = new Set(['reason', 'observation', 'event_id', 'kind', 'observed_at']);
/** Pending backlog above this count produces a non-blocking warning. */
const PENDING_WARNING_THRESHOLD = 20;
/** Ledger kinds an automatic flow can originate; they keep source=automatic. */
const AUTOMATIC_EVIDENCE_KINDS = new Set(['applied_success', 'applied_failure', 'still_valid']);

function cachePaths(projectRoot) {
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
function cacheEventId({ type, target_refid = '', fingerprint = '', source = '' }) {
  const canonical = JSON.stringify([String(type), String(target_refid), String(fingerprint), String(source)]);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}

/** Payload fingerprint: exactly what the entry would write, nothing else. */
function payloadFingerprint({ content = null, record_type = null, group = null } = {}) {
  if (content === null || content === undefined) return '';
  return crypto.createHash('sha256')
    .update(JSON.stringify([String(content), record_type ?? null, group ?? null]), 'utf8')
    .digest('hex');
}

function normaliseEvidence(evidence) {
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
function normalisePayload(payload) {
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

function normaliseEntry(entry) {
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
function parseCache(text) {
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

function readCache(projectRoot) {
  const { file } = cachePaths(projectRoot);
  if (!fs.existsSync(file)) return [];
  return parseCache(fs.readFileSync(file, 'utf8'));
}

function serialiseCache(entries) {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join('');
}

/** Rewrite the cache file atomically. The caller holds cache.lock. */
function writeCache(projectRoot, entries) {
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
function deriveStale(entries, versions) {
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
function groupEntries(entries) {
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

  return { CACHE_FILE, CACHE_LOCK_FILE, CACHE_VERSION, CACHE_OPS, PENDING_WARNING_THRESHOLD, AUTOMATIC_EVIDENCE_KINDS, cachePaths, cacheEventId, payloadFingerprint, normaliseEvidence, normalisePayload, normaliseEntry, parseCache, readCache, writeCache, deriveStale, groupEntries };
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
 *   GET  /api/snapshot        full state snapshot + diagnostics + cache section
 *   PATCH /api/records/:id    restricted single-record update
 *   POST /api/cache/:id/apply     land one pending cache candidate into the store
 *   POST /api/cache/:id/discard   mark one pending candidate discarded (cache-only)
 *   POST /api/cache/prune         drop processed/stale candidates (cache-only)
 *
 * Security contract: loopback only, Host allowlist, bearer token for every
 * /api call (reads included), Origin check on writes, conservative whole-store
 * optimistic concurrency (store_revision), non-blocking lock acquisition
 * (503 when busy), strict JSON body limits.
 */
function createViewerServer(deps) {
  const { fs, path, crypto, http, store, lock, ledger, tags, cache } = deps;
  const { projectRoot, token, pageHtml } = deps;

  const paths = lock.memoryPaths(projectRoot);
  const cacheFile = cache ? cache.cachePaths(projectRoot) : null;
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
    // 标签只是只读旁路元数据：每次快照重载，不能影响存储版本或保存权限。
    const tagState = tags.loadTagTaxonomy(projectRoot);
    diagnostics.push(...tagState.diagnostics);
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
          tags: tagState.enabled ? tags.deriveTags(record, tagState.taxonomy) : [],
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
      format: 'psm-viewer-snapshot-v2',
      // overrides 已反映到记录标签中，不随快照重复传输所有逐记录修正。
      taxonomy: { version: tagState.taxonomy.version, tags: tagState.taxonomy.tags },
      store_revision: storeRevision(),
      read_only: diagnostics.some((x) => x.impact === 'fatal'),
      diagnostics,
      groups: model ? model.groups : [],
      group_dimension: model?.store?.group_dimension || '',
      generated_at: new Date(nowMs).toISOString(),
      records,
      // cache 节是只读旁路：store_revision 口径不变（仍只哈希 memory.md 与
      // evidence.jsonl），cache 不参与其计算。
      cache: buildCacheSection(model, diagnostics),
    };
  }

  /**
   * 快照 cache 节（冻结 schema，工单 02-A）：pending 条目经读时失效派生后按
   * 既有 groupEntries 规则分组，每组附目标记录现状 current。cache 文件缺失
   * 视为空；store 不可读时 versions 传 null，stale 全部为 null（未知不猜）。
   * cache 模块缺失或 cache.jsonl 损坏时降级为空节并记诊断，不阻断整个快照。
   */
  function buildCacheSection(model, diagnostics) {
    if (!cache) return { count: 0, groups: [] };
    let scoped = [];
    try {
      scoped = cache.readCache(projectRoot).filter((entry) => entry.status === 'pending');
    } catch (error) {
      diagnostics.push({ kind: 'cache', message: error.message, impact: 'warning' });
      return { count: 0, groups: [] };
    }
    // 版本对照用快照已解析的记忆库模型；store 不可读（model=null）时传 null，
    // deriveStale 全部 stale:null，不猜。
    const versions = model ? new Map(model.records.map((record) => [record.id, ledger.recordVersion(record)])) : null;
    const derived = cache.deriveStale(scoped, versions);
    const groups = cache.groupEntries(derived).map((group) => ({
      ...group,
      // 对齐 CLI cacheList（memory.mjs cacheTargetSnapshot）：目标记录不存在
      // 时 exists:false，各字段为 null。
      // 冻结 schema：add 组（refid=null）current 为 null；有 refid 但模型里
      // 查不到（或模型不可用）→ exists:false、各字段 null。
      current: group.refid === null
        ? null
        : (model ? cacheTargetCurrent(model, group.refid) : { exists: false, record_version: null, content: null, type: null }),
    }));
    return { count: scoped.length, groups };
  }

  function cacheTargetCurrent(model, refid) {
    const record = model.records.find((item) => item.id === refid);
    if (!record) return { exists: false, record_version: null, content: null, type: null };
    return {
      exists: true,
      record_version: ledger.recordVersion(record),
      content: String(record.content || ''),
      type: record.type,
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
    const payload = await readJsonPostBody(req, res, ['store_revision', 'content', 'type', 'status']);
    if (!payload) return;
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
      // Single-line contract applies only to content that actually changes;
      // resubmitting the record's own body stays a valid metadata-only edit.
      const nextContent = String(payload.content).trim();
      if (nextContent !== String(record.content || '').trim()) {
        const contractErrors = store.contentContractErrors(payload.content);
        if (contractErrors.length) {
          return json(res, 400, { error: 'CONTRACT', message: contractErrors.join('；') });
        }
      }
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

  /**
   * 写路由共用的安检链（patchRecord 与三条 cache 路由同构）：写方法先过 Origin
   * 同源（403 ORIGIN_REJECTED），再 Content-Type（415）、限长读体（413/400
   * BAD_BODY）、JSON 合法（400 BAD_JSON）、字段白名单（400 BAD_FIELDS，白名单
   * 按传入顺序拼接进错误文案）。返回解析后的 payload；已应答时返回 null。
   */
  async function readJsonPostBody(req, res, allowedFields) {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { originHost = ''; }
      if (originHost !== String(req.headers.host || '')) {
        json(res, 403, { error: 'ORIGIN_REJECTED', message: '拒绝跨源写入' });
        return null;
      }
    }
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
      json(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE', message: '只接受 application/json' });
      return null;
    }
    let body;
    try { body = await readBody(req); } catch (error) {
      json(res, error.code === 'TOO_LARGE' ? 413 : 400, { error: 'BAD_BODY', message: error.message });
      return null;
    }
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch {
      json(res, 400, { error: 'BAD_JSON', message: '请求体不是合法 JSON' });
      return null;
    }
    const allowed = new Set(allowedFields);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some((key) => !allowed.has(key))) {
      json(res, 400, { error: 'BAD_FIELDS', message: `只允许 ${[...allowed].join('、')} 字段` });
      return null;
    }
    return payload;
  }

  /**
   * 落库写入复刻 CLI cacheWriteThrough（memory.mjs L727-776）的语义，只复用
   * store/ledger 原语，不 import CLI 函数。持锁调用：
   * - add：store 游标取新 id + push（status active、评分归零）；
   * - update：定位记录改正文 + 评分投影重置；
   * - delete：records 过滤；
   * - ±1：kind 归一化 + task_id 取合法 source 否则 'cache' + assertBaselineFresh
   *   + appendEvent（幂等键 cache-apply-<event_id>，与 CLI 同键；duplicate 按
   *   幂等成功处理）。
   * save 内部完成全量校验、投影同步、备份与原子替换；失败即抛，条目保持 pending。
   */
  function cacheWriteThrough(entry, model) {
    const now = store.timestamp();
    if (entry.type === 'add') {
      const id = newIdFor(model);
      model.records.push({
        id, type: entry.payload.record_type, status: 'active', positive: 0, negative: 0,
        created_at: now, last_scored_at: '', content: entry.payload.content, group: entry.payload.group,
      });
      saveModel(model);
      return { record_id: id };
    }
    if (entry.type === 'update') {
      const record = model.records.find((item) => item.id === entry.target_refid);
      // 与 CLI update 一致：正文变更后 record_version 变化，旧投影不再适用。
      record.content = entry.payload.content;
      record.positive = 0; record.negative = 0; record.last_scored_at = '';
      saveModel(model);
      return { record_id: record.id };
    }
    if (entry.type === 'delete') {
      const record = model.records.find((item) => item.id === entry.target_refid);
      model.records = model.records.filter((item) => item.id !== record.id);
      saveModel(model);
      return { record_id: record.id, deleted: true };
    }
    const record = model.records.find((item) => item.id === entry.target_refid);
    const version = ledger.recordVersion(record);
    const positive = entry.type === '+1';
    const kind = entry.evidence.kind && (positive
      ? ['applied_success', 'still_valid', 'human_positive'].includes(entry.evidence.kind)
      : ['applied_failure', 'human_negative'].includes(entry.evidence.kind))
      ? entry.evidence.kind
      : (positive ? 'human_positive' : 'human_negative');
    const taskId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(entry.source) ? entry.source : 'cache';
    // 账本事件在记忆库写入之前落盘，先做乐观并发预检，基线被外部改动直接拒绝。
    assertBaselineFresh(model);
    // 调用方已持 evidence.lock，不能走会自取阻塞锁的 ledger.appendEvent；
    // 用其导出原语按 appendEvent 的幂等语义内联复刻（duplicate 视为幂等成功）。
    const current = ledger.readLedger(paths.root);
    const event = {
      schema_version: ledger.LEDGER_VERSION,
      event_id: `cache-apply-${entry.event_id}`,
      record_id: record.id,
      record_version: version,
      task_id: taskId,
      kind,
      observed_at: entry.evidence.observed_at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      source: cache.AUTOMATIC_EVIDENCE_KINDS.has(kind) ? 'automatic' : 'manual',
    };
    const existing = current.byId.get(event.event_id);
    if (existing) {
      // 与 appendEvent 相同：observed_at 不参与幂等比较。
      const comparable = (item) => { const { observed_at, ...rest } = item; return rest; };
      if (JSON.stringify(comparable(existing)) !== JSON.stringify(comparable(event))) {
        throw Error(`event_id 冲突: ${event.event_id}`);
      }
      return { record_id: record.id, evidence_kind: kind, duplicate_event: true };
    }
    fs.appendFileSync(paths.ledger, `${JSON.stringify(event)}\n`, 'utf8');
    saveModel(model);
    return { record_id: record.id, evidence_kind: kind, duplicate_event: false };
  }

  /** CLI newId 的等效实现（store 游标取新 id 并推进）。 */
  function newIdFor(model) {
    const id = model.store.next_id;
    model.store.next_id = (BigInt(id) + 1n).toString().padStart(id.length, '0');
    return id;
  }

  /**
   * CLI save 的无锁复刻：调用方已持有 memory.lock + evidence.lock。
   * mustWritable 式全量校验 → syncProjections → 基线比对（与 CLI save 同口径）
   * → serialize → 复查 → 备份 → 原子替换。任何失败先于持久化抛出。
   */
  function saveModel(model) {
    const writeErrors = store.writeErrors(model);
    try { ledger.validateLedger(paths.root); } catch (error) { writeErrors.push({ kind: 'evidence', message: error.message, impact: 'fatal' }); }
    if (writeErrors.length) throw Error(`拒绝写入损坏库: ${writeErrors.map((x) => x.message).join('；')}`);
    const ledgerEvents = ledger.readLedger(paths.root).events;
    for (const item of model.records) {
      const projection = ledger.projectEvents(ledgerEvents, item.id, ledger.recordVersion(item));
      item.positive = projection.positive;
      item.negative = projection.negative;
      item.last_scored_at = projection.last_scored_at;
    }
    const file = paths.memory;
    const onDisk = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
    const fresh = onDisk.length ? store.parseStore(onDisk.toString('utf8')) : null;
    if (!fresh || !fresh.store) throw Error('拒绝写入损坏库: 加锁后重读失败');
    // 与 CLI save 相同的基线比对：next_id、分组形状、分组归属、重叠记录
    // 身份（type|status|content）与被移除记录。
    const before = new Map((fresh.records || []).map((r) => [r.id, `${r.type}|${r.status}|${r.content}`]));
    const edited = new Map(model.records.map((r) => [r.id, `${r.type}|${r.status}|${r.content}`]));
    const overlap = [...edited.keys()].filter((id) => before.has(id));
    const changedOverlap = overlap.filter((id) => before.get(id) !== edited.get(id));
    const removed = [...before.keys()].filter((id) => !edited.has(id));
    // 基线比对与 CLI save 同口径：`__baseline === null` 表示「持锁后刚读过、
    // 本进程就是当前写者」，等效 baselineKnown=true，跳过冲突比对；仅当基线
    // 摘要与磁盘不一致时才逐项比对并拒绝（±1 路径的二次预检）。
    const baselineKnown = model.__baseline === null || model.__baseline === sha(onDisk);
    if (!baselineKnown) {
      const diverged = [];
      if (String(fresh.store.next_id) !== String(model.store.next_id)) diverged.push('next_id');
      const groupShape = (m) => JSON.stringify(m.groups || []) + '|' + (m.store.group_dimension || '');
      if (groupShape(fresh) !== groupShape(model)) diverged.push('groups');
      const freshAssign = new Map((fresh.records || []).map((r) => [r.id, r.group || null]));
      const assignChanged = model.records.filter((r) => freshAssign.has(r.id) && freshAssign.get(r.id) !== (r.group || null)).map((r) => r.id);
      if (assignChanged.length) diverged.push(`分组归属 ${assignChanged.join(', ')}`);
      if (diverged.length || changedOverlap.length || removed.length) {
        throw Object.assign(Error(`PSM_CONFLICT: memory.md 已被外部修改（${changedOverlap.concat(removed, diverged).join(', ') || '?'}）；重读后重试`), { code: 'STORE_CONFLICT' });
      }
    }
    const bytes = Buffer.from(store.serialize(model), 'utf8');
    if (onDisk.equals(bytes)) return false;
    let backup;
    try { backup = lock.backupMemoryFile(paths.root, onDisk); } catch (error) {
      throw Object.assign(Error(`备份失败，未写入: ${error.message}`), { code: 'BACKUP_FAILED' });
    }
    try { lock.atomicReplace(file, bytes); } catch (error) {
      throw Object.assign(Error(`写入失败: ${error.message}`), { code: 'WRITE_FAILED' });
    }
    return { backup: backup.file };
  }

  /**
   * CLI assertBaselineFresh 的等效（仅 ±1 路径）：先写账本后写库，写前确认
   * 基线仍与磁盘一致，避免校验失败时留下半条账本事件。基线取「持锁后读入
   * 模型的当前磁盘摘要」，即本次成功校验时刻的快照。
   */
  function assertBaselineFresh(model) {
    if (!fs.existsSync(paths.memory)) throw Error('PSM_CONFLICT: memory.md 已不存在；重读后重试');
    // 持锁窗口内磁盘只可能因本进程变化；基线未知（null）时以当前磁盘为准。
    if (model.__baseline !== null && model.__baseline !== sha(fs.readFileSync(paths.memory))) {
      throw Error('PSM_CONFLICT: memory.md 已被外部修改；重读后重试');
    }
    model.__baseline = sha(fs.readFileSync(paths.memory));
  }

  /**
   * POST /api/cache/<event_id>/apply：把一条 pending 候选落库。
   * 锁序 cache.lock → memory.lock + evidence.lock（tryAcquireStoreLocks），
   * 全部非阻塞，忙即 503。持锁后重读磁盘（防 TOCTOU），持久化次序与 CLI
   * cacheApply 一致：库写入全部成功后才标 applied + processed_at 并写 cache。
   */
  async function applyCacheEntry(req, res, eventId) {
    const payload = await readJsonPostBody(req, res, ['store_revision', 'content']);
    if (!payload) return;
    if (typeof payload.store_revision !== 'string' || !payload.store_revision) {
      return json(res, 400, { error: 'VALIDATION', message: '缺少 store_revision' });
    }
    if (payload.content !== undefined && typeof payload.content !== 'string') {
      return json(res, 400, { error: 'VALIDATION', message: 'content 必须是字符串' });
    }
    const cacheLease = lock.tryAcquireLock(cacheFile.lock);
    if (!cacheLease) return json(res, 503, { error: 'LOCK_BUSY', message: 'cache.lock 正被其他进程持有；稍后重试' });
    try {
      const entries = cache.readCache(projectRoot);
      const index = entries.findIndex((entry) => entry.event_id === eventId);
      if (index < 0) return json(res, 404, { error: 'NOT_FOUND', message: `不存在 cache 条目: ${eventId}` });
      // 持锁后重读确认条目仍 pending，防 TOCTOU。
      if (entries[index].status !== 'pending') {
        return json(res, 409, { error: 'CONFLICT', message: `cache 条目不是 pending（${entries[index].status}），拒绝落库` });
      }
      // op 非 add/update 时请求带 content → 400 VALIDATION（工单冻结决定）。
      if (payload.content !== undefined && !['add', 'update'].includes(entries[index].type)) {
        return json(res, 400, { error: 'VALIDATION', message: '该操作类型不接受 content 改写' });
      }
      // 提交正文 = 请求改写版（存在时）否则条目暂存版；落库这一刻过单行契约。
      // ±1/delete 条目无 payload（null），正文校验仅对 add/update 有意义。
      const entry = entries[index];
      const content = payload.content !== undefined
        ? payload.content.trim()
        : (entry.payload ? entry.payload.content : null);
      if (entry.payload || payload.content !== undefined) {
        const contractErrors = store.contentContractErrors(content);
        if (contractErrors.length) return json(res, 400, { error: 'CONTRACT', message: contractErrors.join('；') });
      }
      const storeLease = lock.tryAcquireStoreLocks(paths.root);
      if (!storeLease) return json(res, 503, { error: 'LOCK_BUSY', message: 'memory.lock 或 evidence.lock 正被其他进程持有；稍后重试' });
      try {
        // 只读守卫在持锁后：库损坏一律 422，条目保持 pending。
        let model;
        try { model = store.parseStore(fs.readFileSync(paths.memory, 'utf8')); } catch (error) {
          return json(res, 422, { error: 'READ_ONLY', message: `库损坏，只读: ${error.message}` });
        }
        const writeErrors = store.writeErrors(model);
        try { ledger.validateLedger(paths.root); } catch (error) { writeErrors.push({ kind: 'evidence', message: error.message, impact: 'fatal' }); }
        if (writeErrors.length) {
          return json(res, 422, { error: 'READ_ONLY', message: `库损坏，只读: ${writeErrors.map((x) => x.message).join('；')}` });
        }
        // 失效守卫：目标记录不存在或版本已变（原基准 vs 现状）→ 409 拒直写。
        if (entry.target_refid) {
          const record = model.records.find((item) => item.id === entry.target_refid);
          if (!record) {
            return json(res, 409, { error: 'CONFLICT', message: `目标记录已不存在（${entry.target_refid}）；原基准已被删除，请基于现状重新评估` });
          }
          const version = ledger.recordVersion(record);
          if (version !== entry.target_record_version) {
            return json(res, 409, {
              error: 'CONFLICT',
              message: `目标记录已变更（${entry.target_refid}）；候选基于原基准「${String(entry.base_content || '')}」，现状为「${String(record.content || '')}」，请基于现状重新评估`,
            });
          }
        }
        // 乐观并发：请求携带的 store_revision 必须等于当前值。
        const currentRevision = storeRevision();
        if (currentRevision !== payload.store_revision) {
          return json(res, 409, { error: 'CONFLICT', message: '库已被外部修改；请刷新后重试', store_revision: currentRevision });
        }
        // 落库模型：请求带改写版时换成提交正文；基线戳在模型上供
        // assertBaselineFresh 预检（等效 CLI save 的 __baseline 口径）。
        const landing = payload.content !== undefined ? { ...entry, payload: { ...entry.payload, content } } : entry;
        // baselineKnown 跳过分支：saveModel 内重读磁盘与本进程读取一致 → 不比对
        model.__baseline = null;
        let result;
        try { result = cacheWriteThrough(landing, model); } catch (error) {
          if (error && error.code === 'STORE_CONFLICT') {
            return json(res, 409, { error: 'CONFLICT', message: error.message, store_revision: storeRevision() });
          }
          return json(res, 500, { error: 'IO_FAILED', message: error.message });
        }
        // 持久化次序与 CLI cacheApply 一致：库写成功才标 applied + processed_at。
        const next = entries.slice();
        next[index] = { ...entry, status: 'applied', processed_at: store.timestamp() };
        cache.writeCache(projectRoot, next);
        const applied = { ...next[index] };
        return json(res, 200, { applied: true, record_id: result.record_id, entry: applied, snapshot: buildSnapshot() });
      } finally { storeLease.release(); }
    } catch (error) {
      return json(res, 500, { error: 'IO_FAILED', message: error.message });
    } finally { cacheLease.release(); }
  }

  /**
   * POST /api/cache/<event_id>/discard：仅 pending → discarded，持 cache.lock、
   * 锁内重读防竞态；applied 409；重复 discard 幂等 200。只写 cache.jsonl。
   */
  async function discardCacheEntry(req, res, eventId) {
    const payload = await readJsonPostBody(req, res, ['store_revision']);
    if (!payload) return;
    if (typeof payload.store_revision !== 'string' || !payload.store_revision) {
      return json(res, 400, { error: 'VALIDATION', message: '缺少 store_revision' });
    }
    const cacheLease = lock.tryAcquireLock(cacheFile.lock);
    if (!cacheLease) return json(res, 503, { error: 'LOCK_BUSY', message: 'cache.lock 正被其他进程持有；稍后重试' });
    try {
      const entries = cache.readCache(projectRoot);
      const index = entries.findIndex((entry) => entry.event_id === eventId);
      if (index < 0) return json(res, 404, { error: 'NOT_FOUND', message: `不存在 cache 条目: ${eventId}` });
      const entry = entries[index];
      if (entry.status === 'applied') {
        return json(res, 409, { error: 'CONFLICT', message: `cache 条目已落库，不能再丢弃: ${eventId}` });
      }
      if (entry.status !== 'discarded') {
        const next = entries.slice();
        next[index] = { ...entry, status: 'discarded', processed_at: store.timestamp() };
        cache.writeCache(projectRoot, next);
      }
      // 已是 discarded：幂等 200，不重复写。
      return json(res, 200, { applied: true, snapshot: buildSnapshot() });
    } catch (error) {
      return json(res, 500, { error: 'IO_FAILED', message: error.message });
    } finally { cacheLease.release(); }
  }

  /**
   * POST /api/cache/prune：语义同 CLI cachePrune——清 applied|discarded|读时
   * stale 条目，时效起点 processed_at||created_at，持 cache.lock。
   */
  async function pruneCacheEntries(req, res) {
    const payload = await readJsonPostBody(req, res, ['store_revision', 'older_than_days']);
    if (!payload) return;
    if (typeof payload.store_revision !== 'string' || !payload.store_revision) {
      return json(res, 400, { error: 'VALIDATION', message: '缺少 store_revision' });
    }
    let days = null;
    if (payload.older_than_days !== undefined) {
      days = payload.older_than_days;
      if (!Number.isSafeInteger(days) || days < 0) {
        return json(res, 400, { error: 'VALIDATION', message: 'older_than_days 必须是非负整数' });
      }
    }
    const cacheLease = lock.tryAcquireLock(cacheFile.lock);
    if (!cacheLease) return json(res, 503, { error: 'LOCK_BUSY', message: 'cache.lock 正被其他进程持有；稍后重试' });
    try {
      const entries = cache.readCache(projectRoot);
      let model = null;
      try { model = store.parseStore(fs.readFileSync(paths.memory, 'utf8')); } catch { model = null; }
      const versions = model ? new Map(model.records.map((record) => [record.id, ledger.recordVersion(record)])) : null;
      const derived = cache.deriveStale(entries, versions);
      const cutoff = days === null ? null : Date.now() - days * 86400000;
      const kept = [];
      let removed = 0;
      for (const [index, entry] of entries.entries()) {
        // stale 是读时派生态，不写回磁盘；判定只用于决定是否清理。
        const processed = entry.status === 'applied' || entry.status === 'discarded' || derived[index].stale === true;
        const since = entry.processed_at || entry.created_at;
        const oldEnough = cutoff === null || Date.parse(since) <= cutoff;
        if (processed && oldEnough) removed += 1;
        else kept.push(entry);
      }
      if (removed) cache.writeCache(projectRoot, kept);
      return json(res, 200, { removed, snapshot: buildSnapshot() });
    } catch (error) {
      return json(res, 500, { error: 'IO_FAILED', message: error.message });
    } finally { cacheLease.release(); }
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
    // 三条 cache 路由：与 PATCH 相同的 Host + 令牌前置检查，安检链在各自
    // handler 内照 patchRecord 顺序执行。
    const cacheMatch = url.pathname.match(/^\/api\/cache\/([a-f0-9]{32})\/(apply|discard)$/);
    if (cacheMatch && req.method === 'POST') {
      if (!tokenOk(req)) return json(res, 401, { error: 'UNAUTHORIZED', message: '缺少或错误的访问令牌；请使用本次启动输出的地址' });
      const handler = cacheMatch[2] === 'apply' ? applyCacheEntry : discardCacheEntry;
      return handler(req, res, cacheMatch[1]).catch((error) => json(res, 500, { error: 'IO_FAILED', message: error.message }));
    }
    if (url.pathname === '/api/cache/prune' && req.method === 'POST') {
      if (!tokenOk(req)) return json(res, 401, { error: 'UNAUTHORIZED', message: '缺少或错误的访问令牌；请使用本次启动输出的地址' });
      return pruneCacheEntries(req, res).catch((error) => json(res, 500, { error: 'IO_FAILED', message: error.message }));
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
#tag-filter { position: relative; max-width: 100%; }
#tag-filter summary { padding: 3px 10px; border: 1px solid var(--border); border-radius: 3px;
  background: var(--bg-alt); cursor: pointer; }
#tag-options { position: absolute; top: 100%; left: 0; z-index: 4; padding: 6px;
  width: 260px; max-width: calc(100vw - 24px); max-height: 240px; overflow-y: auto;
  background: var(--bg); border: 1px solid var(--border); box-shadow: 0 3px 10px #0002; }
#toolbar #tag-options label { display: flex; gap: 6px; align-items: center;
  white-space: normal; overflow-wrap: anywhere; padding: 3px 0; }
.tag-chip { display: inline-block; max-width: 100%; padding: 0 5px; margin-right: 4px;
  background: var(--bg-alt); border: 1px solid var(--border); border-radius: 3px;
  font-size: 11px; line-height: 18px; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; }
#editor-tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
#editor-tags .tag-chip { white-space: normal; overflow-wrap: anywhere; }
/* 暂存区面板：与编辑器同层的右侧面板，窄屏全屏；徽标沿用 .pill 先例。 */
#cache-btn .count-badge { display: inline-block; min-width: 14px; margin-left: 4px;
  padding: 0 4px; border-radius: 8px; line-height: 16px; font-size: 11px; text-align: center;
  background: var(--accent); border: 1px solid var(--accent); color: #fff; }
#cache-btn.muted .count-badge { background: var(--bg-alt); border-color: var(--border); color: var(--muted); }
#cache-panel { width: 390px; flex: none; border-left: 1px solid var(--border);
  display: flex; flex-direction: column; background: var(--bg); }
#cache-panel.hidden { display: none; }
#cache-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  border-bottom: 1px solid var(--border); font-weight: 600; }
#cache-head .spacer { flex: 1; }
#cache-head button { padding: 2px 8px; border: 1px solid var(--border); border-radius: 3px;
  background: var(--bg-alt); cursor: pointer; }
#cache-head button:hover { border-color: var(--accent); }
#cache-body { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 10px; }
.cache-group { border: 1px solid var(--border); border-radius: 3px; }
.cache-group-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 8px;
  background: var(--bg-alt); border-bottom: 1px solid var(--border); font-weight: 600;
  overflow-wrap: anywhere; }
.cache-group.stale-group { border-color: var(--danger); }
.cache-group .count { color: var(--muted); font-weight: 400; }
.cache-group .warn { color: var(--danger); font-weight: 600; }
.cache-entry { padding: 8px; border-bottom: 1px solid var(--border); display: flex;
  flex-direction: column; gap: 6px; }
.cache-entry:last-child { border-bottom: none; }
.cache-entry .ev { font-size: 12px; color: var(--muted); display: grid;
  grid-template-columns: auto 1fr; gap: 2px 8px; word-break: break-all; }
.cache-entry textarea { width: 100%; min-height: 60px; resize: vertical; padding: 6px;
  border: 1px solid var(--border); border-radius: 3px; font-family: inherit; }
.cache-entry .pair { display: grid; grid-template-columns: 1fr; gap: 4px; }
.cache-entry .pair .old { border-left: 3px solid var(--border); padding: 4px 6px;
  background: var(--bg-alt); white-space: pre-wrap; overflow-wrap: anywhere; }
.cache-entry .pair .old.stale-pair { border-left-color: var(--danger); }
.cache-entry .foot { display: flex; gap: 6px; align-items: center; }
.cache-entry .foot button { padding: 3px 10px; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; }
.cache-entry .foot .write-btn { background: var(--accent); border-color: var(--accent); color: #fff; }
.cache-entry .foot button:disabled { background: var(--muted); border-color: var(--muted); cursor: default; }
.cache-entry .label { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.cache-empty { padding: 24px 0; color: var(--muted); text-align: center; }
.pill.op-add, .pill.op-update { background: var(--type-decision); }
.pill.op-delete { background: var(--type-pitfall); color: var(--danger); }
.pill.op-plus { background: var(--net-pos); color: var(--ok); }
.pill.op-minus { background: var(--net-neg); color: var(--danger); }
.pill.op-stale { background: var(--type-pitfall); color: var(--danger); }
.pill.op-conflict { background: var(--status-review); }
.pill.op-new { background: var(--type-experience); }
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
  #cache-panel { position: fixed; inset: 0; width: auto; z-index: 5; }
  #cache-body { padding: 8px; }  #mobile-toggle { display: inline-block; }
  .hide-narrow { display: none; }
  .group-head { height: auto; min-height: 29px; overflow-wrap: anywhere; }
  #toolbar input[type=search] { width: 130px; max-width: 100%; }
  #tag-filter { position: static; }
  #tag-options { left: 12px; }
  #tag-filter summary { min-height: 32px; }
  col.c-id { width: 44px; }
  col.c-type, col.c-status { width: 48px; }
  col.c-time { width: 90px; }
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
  <details id="tag-filter"><summary id="tag-summary">标签 · 全部</summary>
    <div id="tag-options" role="group" aria-label="标签多选，任一匹配"></div></details>
  <label for="f-evidence">评分</label><select id="f-evidence">
    <option value="">全部</option><option value="has">有证据</option>
    <option value="rated">已评分</option><option value="unrated">未评分</option></select>
  <label for="view-group">分组</label><select id="view-group">
    <option value="type">按类型</option><option value="">不分组</option>
    <option value="status">按状态</option><option value="tag">按标签</option><option value="group">按存储分组</option>
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
  <button id="cache-btn" aria-label="打开或关闭暂存区面板">暂存区<span id="cache-badge" class="count-badge" hidden></span></button>  <button id="reload">重新加载</button>
  <button id="mobile-toggle">列表 / 编辑</button>
</div>
<div id="main">
  <div id="list" role="region" aria-label="记忆列表"></div>
  <section id="editor" class="hidden" aria-label="编辑区">
    <div id="editor-head">编辑</div>
    <div id="editor-body">
      <div id="editor-meta"></div>
      <div id="editor-tags" aria-label="派生标签（只读）"></div>
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
    <section id="cache-panel" class="hidden" aria-label="暂存区">
    <div id="cache-head">暂存区<span class="spacer"></span>
      <button id="cache-prune">清理已处理</button>
      <button id="cache-refresh">刷新</button>
      <button id="cache-close">关闭</button></div>
    <div id="cache-body"></div>
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
  q: '', fType: '', fStatus: '', fGroup: '', fEvidence: '', fTags: [],
  viewGroup: 'type', sortKey: 'created_at', sortDesc: true, colorMode: 'type',
  collapsed: {}, selectedId: null,
  edit: { status: 'clean', draft: null, baseline: null, message: '' },
  cacheDrafts: {}, cacheBusy: false,};

var $ = function (id) { return document.getElementById(id); };
var els = {
  q: $('q'), fType: $('f-type'), fStatus: $('f-status'), fGroup: $('f-group'),
  fEvidence: $('f-evidence'), viewGroup: $('view-group'), sortKey: $('sort-key'),
  sortDir: $('sort-dir'), colorMode: $('color-mode'), reload: $('reload'),
  list: $('list'), editor: $('editor'), editorMeta: $('editor-meta'), editorTags: $('editor-tags'),
  tagOptions: $('tag-options'), tagSummary: $('tag-summary'),
  eType: $('e-type'), eStatus: $('e-status'), eContent: $('e-content'),
  saveBtn: $('save-btn'), resetBtn: $('reset-btn'), dirtyFlag: $('dirty-flag'),
  statusLine: $('status-line'), banner: $('banner'), mobileToggle: $('mobile-toggle'),
  cacheBtn: $('cache-btn'), cacheBadge: $('cache-badge'), cachePanel: $('cache-panel'),
  cacheBody: $('cache-body'), cachePrune: $('cache-prune'),
  cacheRefresh: $('cache-refresh'), cacheClose: $('cache-close'),};

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

function acceptSnapshot(snapshot) {
  state.snapshot = snapshot;
  state.records = snapshot.records || [];
  state.groups = snapshot.groups || [];
  state.readOnly = !!snapshot.read_only;
  var msgs = (snapshot.diagnostics || []).map(function (d) { return d.message; });
  showBanner(state.readOnly ? '库损坏或格式不支持，只读诊断模式：' + msgs.join('；') : msgs.join('；'));
  rebuildGroupFilter();
  updateCacheBadge();  rebuildTagFilter();
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
    acceptSnapshot(r.body);
    render();
    var msg = '共 ' + state.records.length + ' 条 · 修订 ' + r.body.store_revision.slice(0, 8);
    if (state.readOnly) msg += ' · 只读';
    setStatus(msg);
    if (state.selectedId && !findRecord(state.selectedId)) closeEditor();
    if (!els.cachePanel.classList.contains('hidden')) renderCache(true);
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

// v1 快照没有 tags，统一按无标签处理，不改变原有分组与编辑行为。
function recordTags(r) { return Array.isArray(r.tags) ? r.tags : []; }

function updateTagSummary() {
  els.tagSummary.textContent = state.fTags.length ? '标签 · 已选 ' + state.fTags.length + '（任一）' : '标签 · 全部';
}
function rebuildTagFilter() {
  var names = [];
  var add = function (tag) { if (names.indexOf(tag) < 0) names.push(tag); };
  ((state.snapshot.taxonomy || {}).tags || []).forEach(function (rule) { add(rule.name); });
  state.records.forEach(function (r) { recordTags(r).forEach(add); });
  state.fTags = state.fTags.filter(function (tag) { return names.indexOf(tag) >= 0; });
  els.tagOptions.textContent = '';
  var clear = document.createElement('button'); clear.type = 'button'; clear.textContent = '清除筛选';
  clear.addEventListener('click', function () { state.fTags = []; rebuildTagFilter(); render(); });
  els.tagOptions.appendChild(clear);
  if (!names.length) {
    var empty = document.createElement('div'); empty.textContent = '暂无标签'; els.tagOptions.appendChild(empty);
  }
  names.forEach(function (tag) {
    var label = document.createElement('label');
    var input = document.createElement('input'); input.type = 'checkbox'; input.value = tag;
    input.checked = state.fTags.indexOf(tag) >= 0;
    input.addEventListener('change', function () {
      state.fTags = state.fTags.filter(function (value) { return value !== tag; });
      if (input.checked) state.fTags.push(tag);
      updateTagSummary(); render();
    });
    var text = document.createElement('span'); text.textContent = tag;
    label.appendChild(input); label.appendChild(text); els.tagOptions.appendChild(label);
  });
  updateTagSummary();
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
    if (state.fTags.length && !recordTags(r).some(function (tag) { return state.fTags.indexOf(tag) >= 0; })) return false;
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
  if (state.viewGroup === 'tag') return 'tag:' + (recordTags(r)[0] || '');
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
  if (kind === 'tag') return v || '未标记';
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

function tagChip(tag) {
  var chip = document.createElement('span');
  chip.className = 'tag-chip'; chip.textContent = tag; chip.title = tag;
  return chip;
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
  var body = document.createElement('td');
  // 标签分组已在标题显示首标签，行内保留其余标签；其他视图显示全部。
  var tags = recordTags(r); body.title = tags.join(' · ') + (tags.length ? '\\n' : '') + r.content;
  (state.viewGroup === 'tag' ? tags.slice(1) : tags).forEach(function (tag) { body.appendChild(tagChip(tag)); });
  var preview = document.createElement('span'); preview.textContent = r.content.replace(/\\s+/g, ' ');
  body.appendChild(preview);
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
  els.editorTags.textContent = '';
  var tags = recordTags(r);
  if (!tags.length) els.editorTags.textContent = '标签：未标记';
  tags.forEach(function (tag) { els.editorTags.appendChild(tagChip(tag)); });
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
      acceptSnapshot(r.body.snapshot);
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

// ---------------------------------------------------------------------------
// 暂存区面板（cache staging panel）。
// 数据契约：快照 cache 节 { count, groups[] }，组 { key, kind, refid, stale,
// conflict, count, entries[], current }；条目含 cache.jsonl 全部字段 + stale。
// 全部渲染走 textContent/createElement，零 innerHTML。

var CACHE_OP_LABEL = { add: '新增', update: '修订', delete: '删除', '+1': '调分+', '-1': '调分-' };

function cacheSection() {
  var snap = state.snapshot || {};
  // 旧版 server 无 cache 节：按空处理，面板给出空态而非报错。
  return snap.cache || { count: 0, groups: [] };
}

function updateCacheBadge() {
  var info = cacheSection();
  var count = info.count || 0;
  els.cacheBadge.textContent = String(count);
  els.cacheBadge.hidden = count === 0;
  els.cacheBtn.className = count === 0 ? 'muted' : '';
  els.cacheBtn.title = count === 0 ? '暂存区没有待处理项' : '暂存区有 ' + count + ' 条待处理候选';
}

function toggleCachePanel() {
  var hidden = els.cachePanel.classList.toggle('hidden');
  if (!hidden) {
    // 打开时拉一次快照刷新，避免展示陈旧数据（简洁方案）。
    refreshCache(true);
  }
}

function refreshCache(preserveDrafts) {
  if (els.cachePanel.classList.contains('hidden')) return;
  setStatus('加载中…');
  api('/api/snapshot').then(function (r) {
    if (r.status !== 200) { setStatus('加载失败: ' + ((r.body || {}).message || r.status), 'error'); return; }
    acceptSnapshot(r.body);
    render();
    renderCache(preserveDrafts);
    setStatus('共 ' + state.records.length + ' 条 · 修订 ' + r.body.store_revision.slice(0, 8));
  }).catch(function (e) { setStatus('加载失败: ' + e.message, 'error'); });
}

// 渲染整个面板。失败路径不调用本函数（草稿与 DOM 原样保留）。
function renderCache(preserveDrafts) {
  var body = els.cacheBody;
  body.textContent = '';
  var info = cacheSection();
  var gs = info.groups || [];
  if (!(info.count > 0)) {
    var empty = document.createElement('div');
    empty.className = 'cache-empty';
    empty.textContent = '暂存区没有待处理项';
    body.appendChild(empty);
    return;
  }
  for (var i = 0; i < gs.length; i++) body.appendChild(buildCacheGroup(gs[i], preserveDrafts));
}

function buildCacheGroup(group, preserveDrafts) {
  var box = document.createElement('div');
  box.className = 'cache-group' + (group.stale ? ' stale-group' : '');
  var head = document.createElement('div');
  head.className = 'cache-group-head';
  if (group.stale) {
    head.appendChild(pill('op-stale', '失效'));
  } else if (group.kind === 'new') {
    head.appendChild(pill('op-new', '新记录'));
  }
  if (group.refid !== null && group.refid !== undefined) {
    var ref = document.createElement('span'); ref.textContent = '目标 ' + group.refid;
    head.appendChild(ref);
  } else {
    var ref2 = document.createElement('span'); ref2.textContent = '新记录';
    head.appendChild(ref2);
  }
  if (group.conflict) head.appendChild(pill('op-conflict', '冲突'));
  var gcount = document.createElement('span');
  gcount.className = 'count'; gcount.textContent = (group.count || 0) + ' 条';
  head.appendChild(gcount);
  box.appendChild(head);
  for (var i = 0; i < (group.entries || []).length; i++) {
    box.appendChild(buildCacheEntry(group, group.entries[i], preserveDrafts));
  }
  return box;
}

function evidenceRows(entry) {
  var ev = entry.evidence || {};
  var rows = [
    ['理由', ev.reason], ['观察', ev.observation],
    ['来源', ev.kind], ['时间', ev.observed_at],
  ];
  var grid = document.createElement('div'); grid.className = 'ev';
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][1]) continue;
    var dt = document.createElement('div'); dt.textContent = rows[i][0];
    var dd = document.createElement('div'); dd.textContent = rows[i][1];
    grid.appendChild(dt); grid.appendChild(dd);
  }
  return grid;
}

function oldPair(labelText, text, stale) {
  var wrap = document.createElement('div'); wrap.className = 'pair';
  var label = document.createElement('div'); label.className = 'label';
  label.textContent = labelText;
  var old = document.createElement('div'); old.className = 'old' + (stale ? ' stale-pair' : '');
  old.textContent = text;
  wrap.appendChild(label); wrap.appendChild(old);
  return wrap;
}

function buildCacheEntry(group, entry, preserveDrafts) {
  var op = entry.type;
  var stale = entry.stale === true;
  var item = document.createElement('div'); item.className = 'cache-entry';
  var top = document.createElement('div');
  var opPill = pill(op === '+1' ? 'op-plus' : (op === '-1' ? 'op-minus' : 'op-' + op), CACHE_OP_LABEL[op] || op);
  top.appendChild(opPill);
  if (stale) top.appendChild(pill('op-stale', '失效'));
  var src = document.createElement('span');
  src.className = 'label';
  src.textContent = ' · 来源 ' + (entry.source || '—') + ' · 暂存 ' + String(entry.created_at || '').replace('T', ' ').replace('Z', '');
  top.appendChild(src);
  item.appendChild(top);

  // 修订：原正文（base_content）对照；失效：原基准与现状（current.content）双对照。
  if (stale) {
    item.appendChild(oldPair('原基准', entry.base_content == null ? '（无）' : entry.base_content, true));
    var current = group.current;
    item.appendChild(oldPair('现状' + (current && current.exists === false ? '（记录已不存在）' : ''),
      current && current.content ? current.content : '（无）', true));
  } else if (op === 'update') {
    item.appendChild(oldPair('原正文', entry.base_content == null ? '（无）' : entry.base_content, false));
  }

  // 正文：add/update 预填 payload.content 可编辑；失效组无编辑框（只给丢弃）。
  var textarea = null;
  if ((op === 'add' || op === 'update') && !stale && entry.payload && entry.payload.content != null) {
    textarea = document.createElement('textarea');
    textarea.spellcheck = false;
    textarea.value = preserveDrafts && state.cacheDrafts[entry.event_id] != null
      ? state.cacheDrafts[entry.event_id]
      : entry.payload.content;
    textarea.addEventListener('input', function () { state.cacheDrafts[entry.event_id] = textarea.value; });
    item.appendChild(textarea);
  }

  var evGrid = evidenceRows(entry);
  if (evGrid.childNodes.length) item.appendChild(evGrid);

  var foot = document.createElement('div'); foot.className = 'foot';
  var writeBtn = document.createElement('button');
  writeBtn.type = 'button'; writeBtn.className = 'write-btn'; writeBtn.textContent = '写入';
  var dropBtn = document.createElement('button');
  dropBtn.type = 'button'; dropBtn.textContent = '丢弃';
  // 失效组只给「丢弃」，写入入口不提供（失效拒直写）。
  if (stale) {
    foot.appendChild(dropBtn);
  } else {
    writeBtn.addEventListener('click', function () { applyCache(entry, textarea ? textarea.value : null, writeBtn, dropBtn); });
    foot.appendChild(writeBtn);
    foot.appendChild(dropBtn);
  }
  dropBtn.addEventListener('click', function () { discardCache(entry, writeBtn, dropBtn); });
  item.appendChild(foot);
  return item;
}

function setCacheButtonsDisabled(disabled) {
  var buttons = els.cacheBody.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) buttons[i].disabled = disabled;
  els.cachePrune.disabled = disabled;
}

// 失败路径：不重渲染、不清编辑框，草稿保留；setStatus 说明原因（对齐编辑器先例）。
function applyCache(entry, draftContent, writeBtn, dropBtn) {
  if (state.cacheBusy) return;
  if (state.readOnly) { setStatus('库为只读，无法写入暂存候选', 'error'); return; }
  var op = entry.type;
  if ((op === 'delete' || op === '+1' || op === '-1')
    && !confirm((CACHE_OP_LABEL[op] || op) + '候选将直接作用于记录 ' + (entry.target_refid || '') + '，确认写入？')) return;
  state.cacheBusy = true;
  setCacheButtonsDisabled(true);
  setStatus('写入中…');
  var body = { store_revision: state.snapshot.store_revision };
  if (draftContent != null) body.content = draftContent;
  api('/api/cache/' + entry.event_id + '/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (r) {
    if (r.status === 200) {
      acceptSnapshot(r.body.snapshot);
      delete state.cacheDrafts[entry.event_id];
      render(); renderCache(false);
      setStatus('已写入' + (r.body.record_id ? ' · 记录 ' + r.body.record_id : ''));
      return;
    }
    if (r.status === 409) {
      setStatus('冲突：' + ((r.body || {}).message || '库已被外部修改') + '。草稿已保留；点击「重新加载」获取最新内容。', 'conflict');
      return;
    }
    if (r.status === 503) {
      setStatus('存储正被其他进程写入（锁忙），请稍后重试。草稿已保留。', 'error');
      return;
    }
    setStatus('写入失败：' + ((r.body || {}).message || ('HTTP ' + r.status)) + '。草稿已保留。', 'error');
  }).catch(function (e) {
    setStatus('写入失败：' + e.message + '。草稿已保留。', 'error');
  }).then(function () {
    state.cacheBusy = false;
    setCacheButtonsDisabled(false);
  });
}

function discardCache(entry, writeBtn, dropBtn) {
  if (state.cacheBusy) return;
  if (state.readOnly) { setStatus('库为只读，无法丢弃暂存候选', 'error'); return; }
  state.cacheBusy = true;
  setCacheButtonsDisabled(true);
  setStatus('丢弃中…');
  api('/api/cache/' + entry.event_id + '/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_revision: state.snapshot.store_revision }),
  }).then(function (r) {
    if (r.status === 200) {
      acceptSnapshot(r.body.snapshot);
      delete state.cacheDrafts[entry.event_id];
      render(); renderCache(false);
      setStatus('已丢弃');
      return;
    }
    if (r.status === 409) {
      setStatus('冲突：' + ((r.body || {}).message || '候选状态已变化') + '。点击「刷新」获取最新内容。', 'conflict');
      return;
    }
    if (r.status === 503) {
      setStatus('存储正被其他进程写入（锁忙），请稍后重试。', 'error');
      return;
    }
    setStatus('丢弃失败：' + ((r.body || {}).message || ('HTTP ' + r.status)), 'error');
  }).catch(function (e) {
    setStatus('丢弃失败：' + e.message, 'error');
  }).then(function () {
    state.cacheBusy = false;
    setCacheButtonsDisabled(false);
  });
}

function pruneCache() {
  if (state.cacheBusy) return;
  if (state.readOnly) { setStatus('库为只读，无法清理暂存区', 'error'); return; }
  if (!confirm('清理全部已处理与已失效的暂存条目？此操作不可撤销。')) return;
  state.cacheBusy = true;
  setCacheButtonsDisabled(true);
  setStatus('清理中…');
  api('/api/cache/prune', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_revision: state.snapshot.store_revision }),
  }).then(function (r) {
    if (r.status === 200) {
      acceptSnapshot(r.body.snapshot);
      render(); renderCache(false);
      setStatus('已清理 ' + ((r.body || {}).removed != null ? r.body.removed : '?') + ' 条已处理条目');
      return;
    }
    if (r.status === 503) {
      setStatus('存储正被其他进程写入（锁忙），请稍后重试。', 'error');
      return;
    }
    setStatus('清理失败：' + ((r.body || {}).message || ('HTTP ' + r.status)), 'error');
  }).catch(function (e) {
    setStatus('清理失败：' + e.message, 'error');
  }).then(function () {
    state.cacheBusy = false;
    setCacheButtonsDisabled(false);
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
els.cacheBtn.addEventListener('click', toggleCachePanel);
els.cacheClose.addEventListener('click', toggleCachePanel);
els.cacheRefresh.addEventListener('click', function () { refreshCache(true); });
els.cachePrune.addEventListener('click', pruneCache);els.mobileToggle.addEventListener('click', function () {
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
const tags = tagsFactory({}, fs, path);
const cache = cacheFactory({ TYPES: store.TYPES }, crypto, fs, path);
const server = serverFactory({});
const page = pageFactory({});

const argv = process.argv.slice(2);
const portFlag = argv.indexOf('--port');
const port = portFlag >= 0 ? Number(argv[portFlag + 1]) : 0;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PSM_VIEWER_ERROR: --port 必须是 0..65535 的整数');
  process.exit(1);
}
// 默认用系统默认浏览器打开带令牌的地址；--no-open 或 PSM_VIEWER_OPEN=0 禁止，
// 打开失败不致命。PSM_VIEWER_OPEN=echo 只打印地址不执行，供无头环境与测试
// 诊断（优先级最高）。--open 保留为兼容写法，与默认行为相同。
const openMode = process.env.PSM_VIEWER_OPEN === 'echo'
  ? 'echo'
  : (argv.includes('--no-open') || process.env.PSM_VIEWER_OPEN === '0' ? '' : 'open');
function launchBrowser(url) {
  if (openMode === 'echo') { console.log('PSM_VIEWER_OPEN_URL: ' + url); return; }
  const childProcess = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  import('node:child_process').then(({ spawn }) => {
    const child = spawn(childProcess[0], childProcess[1], { detached: true, stdio: 'ignore', shell: false });
    child.on('error', () => console.log('PSM_VIEWER_OPEN_FAILED: 请手动复制上方地址到浏览器'));
    child.unref();
  }).catch(() => console.log('PSM_VIEWER_OPEN_FAILED: 请手动复制上方地址到浏览器'));
}

// Memory directory is pinned to the nearest '.project-self-memory/' inside the
// script's own directory; arbitrary paths are refused.
// 部署契约：脚本随 init 放在 '.project-self-memory/' 内（basename 为
// '.project-self-memory' 时取父目录）；复制到项目根手动启动也受支持。
// 不用 require.resolve：ESM 宿主没有 require。
const scriptDir = path.dirname(path.resolve(process.argv[1] || '.'));
const projectRoot = path.basename(scriptDir) === '.project-self-memory' ? path.dirname(scriptDir) : scriptDir;
const token = crypto.randomBytes(32).toString('hex');
const { server: httpServer } = server.createViewerServer({
  fs, path, crypto, http, store, lock, ledger, tags, cache,
  projectRoot, token, pageHtml: page.VIEWER_PAGE_HTML,
});
httpServer.listen(port, '127.0.0.1', () => {
  const address = httpServer.address();
  const url = 'http://127.0.0.1:' + address.port + '/#token=' + token;
  console.log('PSM_VIEWER_URL: ' + url);
  console.log('记忆目录: ' + path.join(projectRoot, '.project-self-memory'));
  console.log('只监听本机回环；停止服务请按 Ctrl+C。');
  if (openMode === 'open' || openMode === 'echo' || openMode === '1') launchBrowser(url);
});
})().catch((error) => {
  console.error('PSM_VIEWER_ERROR: ' + error.message);
  process.exit(1);
});
