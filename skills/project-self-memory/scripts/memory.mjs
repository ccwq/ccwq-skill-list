#!/usr/bin/env node
/** Deterministic, dependency-free store manager for project-self-memory. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  appendEvent,
  initializeLedger,
  inspectLedger,
  migrateLegacyScores,
  projectEvents,
  projectRecord,
  readLedger,
  recordVersion,
  validateLedger,
} from './evidence-ledger.mjs';
import {
  GROUP_KEYS,
  RECORD_KEYS,
  STATUS,
  STORE_KEYS,
  TYPE_LABEL,
  TYPES,
  assertContentContract,
  canonicalId,
  contentContractErrors,
  escapeXml,
  issue,
  parseStore,
  serialize,
  timestamp,
  validateModel,
  writeErrors,
} from './memory-store.mjs';
import {
  acquireMemoryLockSync,
  atomicReplace,
  backupMemoryFile,
} from './memory-lock.mjs';

import { loadTagTaxonomy, normaliseTaxonomy, tagRecords, suggestTaxonomy } from './memory-tags.mjs';

const CONFIG_DEFAULT = {
  version: 1, auto_load: true, auto_save: true, auto_rate: true,
  load_mode: 'relevant', max_context_tokens: 4096, max_records: 24,
  min_confidence: 0, min_utility: 0, min_freshness: 0,
};
const raw = process.argv.slice(2);
const args = raw.filter((v, i) => v !== '--project-root' && raw[i - 1] !== '--project-root');
const opt = (name) => { const i = raw.indexOf(name); return i < 0 ? null : raw[i + 1]; };
const has = (name) => args.includes(name);
const die = (message) => { console.error(`PSM_ERROR: ${message}`); process.exit(1); };
const json = (data) => console.log(JSON.stringify(data, null, 2));
function paths() { const root = path.resolve(opt('--project-root') || process.cwd()); const base = path.join(root, '.project-self-memory'); return { root, base, memory: path.join(base, 'memory.md'), config: path.join(base, 'config.yaml'), legacy: path.join(root, 'self-memory', 'memory.md') }; }
function contentInput() {
  const file = opt('--content-file');
  const value = file ? fs.readFileSync(path.resolve(file), 'utf8') : !process.stdin.isTTY ? fs.readFileSync(0, 'utf8') : null;
  if (!value?.trim()) throw Error('正文必须通过 --content-file 或标准输入提供');
  // 契约只约束“新正文”：去除外围空白（含文本文件末尾换行）后必须单行。
  // 历史多行正文与磁盘字节一致地重新提交时走 unchangedFor 路径豁免。
  assertContentContract(value);
  return value.trim();
}

/** Same as contentInput but allows resubmitting a record's own on-disk body verbatim. */
function contentInputFor(model, recordId) {
  const file = opt('--content-file');
  const value = file ? fs.readFileSync(path.resolve(file), 'utf8') : !process.stdin.isTTY ? fs.readFileSync(0, 'utf8') : null;
  if (!value?.trim()) throw Error('正文必须通过 --content-file 或标准输入提供');
  const record = model.records.find((item) => item.id === recordId);
  const next = value.trim();
  if (record && next === String(record.content || '').trim()) return next; // no-op metadata-style update
  assertContentContract(value);
  return next;
}

function loadStore() { const file = paths().memory; if (!fs.existsSync(file)) throw Error('缺少 memory.md；先运行 init'); const model = withBaseline(parseStore(fs.readFileSync(file, 'utf8'))); model.records = tagRecords(model.records, loadTagTaxonomy(paths().root)); return model; }
function mustWritable(model) { const errors = writeErrors(model); try { validateLedger(paths().root); } catch (error) { errors.push(issue('evidence', error.message, { impact: 'fatal' })); } if (errors.length) throw Error(`拒绝写入损坏库: ${errors.map((x) => x.message).join('；')}`); }

/**
 * Durable write path shared by every CLI command and (via the same factory
 * sources) the viewer server: lock → re-read → optimistic check → validate →
 * backup → atomic replace. A model that no longer matches the file on disk is
 * rejected as PSM_CONFLICT instead of silently overwriting another writer.
 */
function save(model) {
  mustWritable(model);
  syncProjections(model);
  const root = paths().root;
  const file = paths().memory;
  const lease = acquireMemoryLockSync(root);
  try {
    const onDisk = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
    const fresh = onDisk.length ? parseStore(onDisk.toString('utf8')) : null;
    if (!fresh || !fresh.store) throw Error('拒绝写入损坏库: 加锁后重读失败');
    // Optimistic concurrency: the model the caller edited must have been read
    // from this exact file. Compare next_id and per-record identity+content;
    // a mismatch means an external writer won the race.
    const before = new Map((fresh.records || []).map((r) => [r.id, `${r.type}|${r.status}|${r.content}`]));
    const edited = new Map(model.records.map((r) => [r.id, `${r.type}|${r.status}|${r.content}`]));
    const overlap = [...edited.keys()].filter((id) => before.has(id));
    const changedOverlap = overlap.filter((id) => before.get(id) !== edited.get(id));
    const removed = [...before.keys()].filter((id) => !edited.has(id));
    const baselineKnown = model.__baseline === shaBytes(onDisk);
    if (!baselineKnown) {
      // 保守策略（规格）：基线外任何字段（next_id、分组、分配、其他记录）被外部
      // 改动都返回冲突，而不是自动合并。
      const diverged = [];
      if (String(fresh.store.next_id) !== String(model.store.next_id)) diverged.push('next_id');
      const groupShape = (m) => JSON.stringify(m.groups || []) + '|' + (m.store.group_dimension || '');
      if (groupShape(fresh) !== groupShape(model)) diverged.push('groups');
      const freshAssign = new Map((fresh.records || []).map((r) => [r.id, r.group || null]));
      const assignChanged = model.records.filter((r) => freshAssign.has(r.id) && freshAssign.get(r.id) !== (r.group || null)).map((r) => r.id);
      if (assignChanged.length) diverged.push(`分组归属 ${assignChanged.join(', ')}`);
      if (diverged.length || changedOverlap.length || removed.length) {
        throw Error(`PSM_CONFLICT: memory.md 已被外部修改（${changedOverlap.concat(removed, diverged).join(', ') || '?'}）；重读后重试`);
      }
    }
    const bytes = Buffer.from(serialize(model), 'utf8');
    if (onDisk.equals(bytes)) return false; // no change: no backup, no rewrite
    const backup = backupMemoryFile(root, onDisk);
    atomicReplace(file, bytes);
    process.env.PSM_QUIET || console.error(`PSM_BACKUP: ${backup.file}`);
    return true;
  } finally {
    lease.release();
  }
}

/** Stamp the baseline digest on a freshly loaded model (see save). */
function withBaseline(model) { model.__baseline = shaBytes(fs.readFileSync(paths().memory)); return model; }
function shaBytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function find(model, id) { const record = model.records.find((x) => x.id === id); if (!record) throw Error(`不存在记录: ${id}`); return record; }
function newId(model) { const id = model.store.next_id; model.store.next_id = (BigInt(id) + 1n).toString().padStart(id.length, '0'); return id; }

// positive/negative/last_scored_at are compatibility projections.  The ledger
// remains the only source of truth, including when an unrelated record is
// written after an external evidence append.
function syncProjections(model) {
  const ledger = readLedger(paths().root);
  for (const record of model.records) {
    const projection = projectEvents(ledger.events, record.id, recordVersion(record));
    record.positive = projection.positive;
    record.negative = projection.negative;
    record.last_scored_at = projection.last_scored_at;
  }
  return model;
}

function configText(config) { return `# project-self-memory 自动化配置，仅控制行为，不保存经验。
# 请通过 memory.mjs config 命令修改；未知、重复或非法值会使自动行为 fail-closed。

# Given：配置格式需要与当前运行时兼容。
# When：init、config reset 或 config repair 生成文件。
# Then：必须为 1；其他版本拒绝自动加载、保存和评分。
# 防回归：旧/未来 schema 被静默当作可用配置。
# 取值：固定为 1。参考值：1。
version: ${config.version}

# Given：任务开始且 store/ledger 校验通过。
# When：auto_load 为 true。
# Then：按 load_mode 和预算选择记忆；false 时不读取正文、不注入上下文。
# 防回归：关闭加载后 sentinel 仍进入 Agent payload。
# 取值：true | false。参考值：true；敏感或零上下文任务用 false。
auto_load: ${config.auto_load}

# Given：宿主显式提交且已确认的保存候选。
# When：auto_save 为 true。
# Then：仅保存 verified、isNew、conflictFree 的 host 候选。
# 防回归：Agent 自报 conclusion 或未验证内容被自动写入。
# 取值：true | false。参考值：true；只读任务用 false。
auto_save: ${config.auto_save}

# Given：当前任务已加载某条记忆，宿主提交直接、可归因的结果。
# When：auto_rate 为 true。
# Then：写入带 task/version 的幂等 evidence event；无法归因的失败仅进入 review。
# 防回归：重试刷分、Agent 自述或旧版本证据改变当前分数。
# 取值：true | false。参考值：true；人工审核优先时用 false。
auto_rate: ${config.auto_rate}

# Given：auto_load 为 true。
# When：开始选择记忆。
# Then：off 不加载；relevant 仅加载相关记录；all 仅允许显式 maintenance/diagnostic 任务。
# 防回归：损坏配置或普通任务静默退回全量加载。
# off 特点：上下文占用为 0；适合敏感、纯业务或明确禁用记忆的任务。
# relevant 特点：先做相关性、质量和预算筛选；适合绝大多数日常任务，能减少无关历史。
# all 特点：读取所有 active 记录，排障/人工维护可完整查看；上下文成本最高，普通任务不可隐式启用。
# 取值：off | relevant | all。参考值：relevant。
load_mode: ${config.load_mode}

# Given：相关候选多于上下文可容纳内容。
# When：生成最终 Agent payload。
# Then：估算 token 总量不得超过此上限。
# 防回归：单次任务把全部历史记忆塞进上下文。
# 取值：正整数。参考值：4096；紧凑任务可用 1024 或 2048。
max_context_tokens: ${config.max_context_tokens}

# Given：通过相关性和质量门槛的记录多于需要。
# When：选择最终记忆列表。
# Then：选中记录数不得超过此上限。
# 防回归：短记录绕过 token 限制造成上下文主题过多。
# 取值：正整数。参考值：24；小任务可用 8 或 12。
max_records: ${config.max_records}

# Given：记录与当前任务相关。
# When：判断其当前版本是否有足够验证支持。
# Then：confidence 低于此阈值时排除并写入 selection audit。
# 防回归：低样本偶然成功压过长期已验证记录。
# 取值：0..1。参考值：0；需要更保守筛选时可用 0.25 或 0.5。
min_confidence: ${config.min_confidence}

# Given：记录与当前任务相关且具有当前版本评分。
# When：判断其历史实际使用价值。
# Then：utility 低于此阈值时排除并写入 selection audit。
# 防回归：历史上无效的记忆仅因相关而持续占用上下文。
# 取值：0..1。参考值：0；需要效果门槛时可用 0.25 或 0.5。
min_utility: ${config.min_utility}

# Given：记录属于会随时间变化的事实、经验或避坑。
# When：判断其是否仍可能有效。
# Then：freshness 低于此阈值时排除或进入复核；决策/约束不会仅因时间自动失效。
# 防回归：过时高分事实持续进入任务上下文。
# 取值：0..1。参考值：0；易变项目可用 0.25 或 0.5。
min_freshness: ${config.min_freshness}
`; }
function parseConfig(text, allowMissing = false) {
  const out = {}; const errors = [];
  const integerKeys = new Set(['max_context_tokens', 'max_records']);
  const floatKeys = new Set(['min_confidence', 'min_utility', 'min_freshness']);
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const m = s.match(/^([a-z_]+):\s*(\S+)\s*$/);
    if (!m || !Object.hasOwn(CONFIG_DEFAULT, m[1]) || Object.hasOwn(out, m[1])) {
      errors.push(issue('config', `配置非法、重复或未知键: ${s}`, { line: index + 1, impact: 'fatal' })); continue;
    }
    const [key, value] = [m[1], m[2]];
    if (key === 'version') out[key] = Number(value);
    else if (key.startsWith('auto_')) {
      if (value !== 'true' && value !== 'false') errors.push(issue('config', `布尔值只能为 true/false: ${key}`, { line: index + 1, impact: 'fatal' }));
      else out[key] = value === 'true';
    } else if (key === 'load_mode') {
      if (!['off', 'relevant', 'all'].includes(value)) errors.push(issue('config', `load_mode 只能为 off/relevant/all`, { line: index + 1, impact: 'fatal' }));
      else out[key] = value;
    } else if (integerKeys.has(key)) {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10000000) errors.push(issue('config', `${key} 必须是 1..10000000 的安全整数`, { line: index + 1, impact: 'fatal' }));
      else out[key] = parsed;
    } else if (floatKeys.has(key)) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) errors.push(issue('config', `${key} 必须是 0..1 的数字`, { line: index + 1, impact: 'fatal' }));
      else out[key] = parsed;
    }
  }
  if (out.version !== undefined && out.version !== 1) errors.push(issue('config', 'version 必须为 1', { impact: 'fatal' }));
  const missing = Object.keys(CONFIG_DEFAULT).filter((key) => !Object.hasOwn(out, key));
  if (!allowMissing && missing.length) errors.push(issue('config', `缺少配置键: ${missing.join(', ')}`, { impact: 'repairable' }));
  return { config: { ...CONFIG_DEFAULT, ...out }, errors, missing };
}
function loadConfig() { const file = paths().config; if (!fs.existsSync(file)) return { config: CONFIG_DEFAULT, errors: [issue('config', '缺少 config.yaml', { impact: 'repairable' })], missing: Object.keys(CONFIG_DEFAULT) }; return parseConfig(fs.readFileSync(file, 'utf8')); }
function initialize() { const p = paths(); fs.mkdirSync(p.base, { recursive: true }); if (!fs.existsSync(p.config)) fs.writeFileSync(p.config, configText(CONFIG_DEFAULT)); if (!fs.existsSync(p.memory)) fs.writeFileSync(p.memory, '<!-- <psm-store version="1" next_id="0001" group_dimension="" /> -->\n'); initializeLedger(p.root); viewerDeploy({ quiet: true }); console.log('PSM_INITIALIZED'); }

// --- viewer deployment contract -------------------------------------------
// New projects get the viewer on init; existing projects opt in with an
// explicit `viewer install`. Updates replace the file only when its whole
// content hash matches a known official build — a locally modified script is
// never silently overwritten, and symlinks are always refused.
function viewerSource() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'viewer-dist', 'view-memoery.js'); }
function viewerManifest() { const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'viewer-dist', 'manifest.json'); try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { hashes: {} }; } }
function viewerTarget() { return path.join(paths().base, 'view-memoery.js'); }
function viewerState() {
  const target = viewerTarget();
  if (!fs.existsSync(target)) return { exists: false };
  const stat = fs.lstatSync(target);
  const hash = stat.isFile() && !stat.isSymbolicLink() ? shaBytes(fs.readFileSync(target)) : null;
  const official = hash ? Object.hasOwn(viewerManifest().hashes || {}, hash) : false;
  const current = viewerSource() && fs.existsSync(viewerSource()) ? shaBytes(fs.readFileSync(viewerSource())) : null;
  return { exists: true, symlink: stat.isSymbolicLink(), hash, official, current, up_to_date: hash !== null && hash === current };
}
function viewerDeploy({ quiet = false, update = false } = {}) {
  const target = viewerTarget();
  const source = viewerSource();
  if (!fs.existsSync(source)) { if (!quiet) console.error('PSM_VIEWER_SOURCE_MISSING: viewer-dist/view-memoery.js 不存在；先运行 build-viewer.mjs'); return { deployed: false }; }
  const state = viewerState();
  if (!state.exists) { fs.copyFileSync(source, target); if (!quiet) console.log('PSM_VIEWER_INSTALLED'); return { deployed: true }; }
  if (state.symlink) { if (!quiet) console.error('PSM_VIEWER_REFUSED: 目标是符号链接，拒绝替换'); return { deployed: false, refused: 'symlink' }; }
  if (state.up_to_date) { if (!quiet) console.log('PSM_VIEWER_CURRENT'); return { deployed: false, current: true }; }
  if (!update) { if (!quiet) console.log('PSM_VIEWER_KEPT: 已存在，保留（init 不隐式升级）'); return { deployed: false, kept: true }; }
  if (!state.official) { if (!quiet) console.error('PSM_VIEWER_REFUSED: 本地文件与所有官方产物哈希不符，拒绝覆盖修改'); return { deployed: false, refused: 'modified' }; }
  fs.copyFileSync(source, target);
  if (!quiet) console.log('PSM_VIEWER_UPDATED: 已替换官方旧版；若服务正在运行，请重启');
  return { deployed: true, updated: true };
}
function viewerCommand() {
  const sub = args[1] || 'status';
  if (sub === 'status') return json(viewerState());
  if (sub === 'install') { const r = viewerDeploy({ quiet: false }); process.exit(r.refused ? 1 : 0); }
  if (sub === 'update') { const r = viewerDeploy({ quiet: false, update: true }); process.exit(r.refused ? 1 : 0); }
  throw Error('未知 viewer 子命令');
}

function validate() { const config = loadConfig(); let store; try { store = loadStore(); validateLedger(paths().root); } catch (e) { die(e.message); } const errors = [...config.errors, ...validateModel(store)]; if (errors.length) die(errors.map((x) => `${x.kind}: ${x.message}`).join('\n')); console.log('PSM_VALID'); }
function diagnose() { const config = loadConfig(); let model; let evidenceError = null; try { model = loadStore(); try { validateLedger(paths().root); } catch (error) { evidenceError = issue('evidence', error.message, { impact: 'fatal' }); } } catch (e) { return json({ config: config.errors, store: [issue('store', e.message, { impact: 'fatal' })], group: [], record: [], legacy: [], evidence: [], valid_records: 0, write_safe: false }); } const errors = writeErrors(model); if (evidenceError) errors.push(evidenceError); const by = (kind) => errors.filter((x) => x.kind === kind); const badIds = new Set(by('record').map((x) => x.id)); json({ config: config.errors, store: by('store'), group: by('group'), record: by('record'), legacy: model.legacy.map((content, index) => ({ line: index + 1, content })), evidence: by('evidence'), tags: loadTagTaxonomy(paths().root).diagnostics, valid_records: Math.max(0, model.records.filter((x) => !badIds.has(x.id)).length), write_safe: errors.length === 0 }); }
function read() { const model = loadStore(); const ledger = readLedger(paths().root); const errors = validateModel(model); if (errors.some((x) => x.impact === 'fatal')) die(errors.map((x) => x.message).join('；')); const invalid = new Set(errors.filter((x) => x.kind === 'record').map((x) => x.id)); const wanted = new Set((opt('--ids') || '').split(',').filter(Boolean)); const wantedGroups = new Set((opt('--group') || '').split(',').filter(Boolean)); const wantedTags = new Set((opt('--tag') || '').split(',').filter(Boolean)); const type = opt('--type'); const visible = model.records.filter((x) => x.status === 'active' && !invalid.has(x.id) && (!wantedTags.size || x.tags.some((tag) => wantedTags.has(tag))) && (!wanted.size || wanted.has(x.id)) && (!wantedGroups.size || wantedGroups.has(x.group)) && (!type || x.type === type)); let lastGroup = Symbol('none'); for (const record of visible) { const version = recordVersion(record); const projection = projectEvents(ledger.events, record.id, version); if (record.group !== lastGroup) { const group = model.groups.find((x) => x.id === record.group); if (group) console.log(`## ${group.title}`); lastGroup = record.group; } console.log(`[${record.id}][${TYPE_LABEL[record.type]}] ${record.content}`); } }
function add() { const type = opt('--type'); if (!TYPES.has(type)) throw Error('--type 必须是合法类型'); const model = loadStore(); mustWritable(model); const group = opt('--group'); if (group && !model.groups.some((x) => x.id === group)) throw Error(`未知分组: ${group}`); const id = newId(model); model.records.push({ id, type, status: 'active', positive: 0, negative: 0, created_at: timestamp(), last_scored_at: '', content: contentInput(), group }); save(model); console.log(id); }
function update() {
  const model = loadStore(); mustWritable(model); const record = find(model, args[1]);
  const old = projectRecord(paths().root, record);
  record.content = contentInputFor(model, record.id);
  if (has('--keep-score')) {
    appendEvent(paths().root, {
      record_id: record.id,
      record_version: recordVersion(record),
      task_id: `manual-${process.pid}`,
      kind: 'projection_repair',
      source: 'system',
      projection: { positive: old.positive, negative: old.negative },
    });
  } else {
    record.positive = 0; record.negative = 0; record.last_scored_at = '';
  }
  save(model); console.log(record.id);
}
function score(mode) {
  const model = loadStore();
  mustWritable(model);
  const record = find(model, args[1]);
  const version = recordVersion(record);
  const common = { record_id: record.id, record_version: version, task_id: opt('--task-id') || `manual-${process.pid}`, event_id: opt('--event-id') || undefined, observed_at: opt('--observed-at') || undefined };
  let input;
  if (mode === 'reset') {
    input = { ...common, kind: 'projection_reset', source: 'system' };
  } else if (mode === 'repair') {
    const positive = Number(opt('--positive')); const negative = Number(opt('--negative'));
    if (!Number.isSafeInteger(positive) || positive < 0 || !Number.isSafeInteger(negative) || negative < 0) throw Error('评分必须为非负整数');
    input = { ...common, kind: 'projection_repair', source: 'system', projection: { positive, negative } };
  } else {
    const vote = args[2];
    if (vote !== '+1' && vote !== '-1') throw Error('日常评分只接受 +1 或 -1');
    input = { ...common, kind: vote === '+1' ? 'human_positive' : 'human_negative', source: 'manual' };
  }
  appendEvent(paths().root, input);
  save(model);
  json(projectRecord(paths().root, record));
}
function merge() {
  const model = loadStore(); mustWritable(model);
  const keep = opt('--keep'); const remove = opt('--remove');
  if (!keep || !remove || keep === remove) throw Error('merge 的 keep 与 remove 必须为两个不同 ID');
  if (BigInt(keep) >= BigInt(remove)) throw Error('keep 必须是较早的永久 ID');
  const record = find(model, keep); const removed = find(model, remove);
  const keepVersion = recordVersion(record); const removedVersion = recordVersion(removed);
  record.content = contentInputFor(model, keep); record.positive = 0; record.negative = 0; record.last_scored_at = '';
  const mergedVersion = recordVersion(record);
  appendEvent(paths().root, {
    event_id: `merge-${keep}-${remove}-${mergedVersion.slice(0, 16)}`,
    record_id: keep, record_version: mergedVersion, task_id: `merge-${keep}-${remove}`,
    kind: 'merge_lineage', source: 'system', lineage: [
      { record_id: keep, record_version: keepVersion },
      { record_id: remove, record_version: removedVersion },
    ],
  });
  model.records = model.records.filter((x) => x.id !== remove); save(model); console.log(keep);
}
/** Explicit taxonomy writes share the memory lock; never serialize the main store. */
function saveTaxonomy(makeNext) {
  const p = paths();
  const lease = acquireMemoryLockSync(p.root);
  try {
    const target = path.join(p.base, 'tags.json');
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error('拒绝替换 tags.json 符号链接');
    const current = loadTagTaxonomy(p.root);
    const next = normaliseTaxonomy(makeNext(current));
    const bytes = Buffer.from(JSON.stringify(next, null, 2) + '\n');
    if (bytes.length > 1024 * 1024) throw Error('tags.json 超过 1 MiB，拒绝写入');
    if (fs.existsSync(target)) {
      const original = fs.readFileSync(target);
      if (original.equals(bytes)) return false;
      const backups = path.join(p.base, 'backups');
      fs.mkdirSync(backups, { recursive: true });
      const backup = path.join(backups, `tags-${crypto.randomUUID()}.json`);
      fs.writeFileSync(backup, original, { flag: 'wx' });
      if (!fs.readFileSync(backup).equals(original)) throw Error('标签备份校验失败');
    }
    atomicReplace(target, bytes);
    return true;
  } finally { lease.release(); }
}
function tagCatalog(records) {
  const counts = new Map();
  for (const record of records) for (const tag of record.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, count]) => ({ name, count }));
}
function tagsCommand() {
  const sub = args[1] || 'show';
  const model = loadStore();
  const loaded = loadTagTaxonomy(paths().root);
  if (sub === 'show') return json(loaded);
  if (sub === 'suggest') return json(suggestTaxonomy(model.records, loaded));
  if (sub === 'stats') return json({ total_records: model.records.length, tagged_records: model.records.filter((r) => r.tags.length).length, tags: tagCatalog(model.records), diagnostics: loaded.diagnostics });
  mustWritable(model);
  if (sub === 'apply') {
    if (!opt('--plan-file')) throw Error('缺少 --plan-file');
    const plan = normaliseTaxonomy(JSON.parse(fs.readFileSync(path.resolve(opt('--plan-file')), 'utf8')));
    if (Object.keys(plan.overrides).some((id) => !model.records.some((record) => record.id === id))) throw Error('override 引用未知记录');
    return json({ applied: saveTaxonomy(() => plan) });
  }
  if (sub === 'set') {
    find(model, args[2]);
    if (!has('--add') && !has('--remove')) throw Error('必须提供 --add 或 --remove');
    const add = (opt('--add') || '').split(',').filter(Boolean);
    const remove = (opt('--remove') || '').split(',').filter(Boolean);
    return json({ applied: saveTaxonomy((current) => {
      if (!current.enabled) throw Error('分类标准损坏；先用 tags apply 显式修复');
      const next = current.taxonomy;
      const prior = next.overrides[args[2]] || { add: [], remove: [] };
      next.overrides[args[2]] = {
        add: [...new Set([...prior.add.filter((tag) => !remove.includes(tag)), ...add])],
        remove: [...new Set([...prior.remove.filter((tag) => !add.includes(tag)), ...remove])],
      };
      return next;
    }) });
  }
  throw Error('未知 tags 子命令');
}

function groups() { const sub = args[1]; const model = loadStore(); mustWritable(model); if (sub === 'show') return json({ dimension: model.store.group_dimension, groups: model.groups }); if (sub === 'apply') { const plan = JSON.parse(fs.readFileSync(path.resolve(opt('--plan-file')), 'utf8')); if (!plan.group_dimension || !Array.isArray(plan.groups) || !plan.assignments || typeof plan.assignments !== 'object') throw Error('分组计划必须包含非空 group_dimension、groups、assignments'); const ids = new Set(); for (const g of plan.groups) { if (!g || !/^[a-z0-9][a-z0-9-]*$/.test(g.id) || !g.title || !g.scope || ids.has(g.id)) throw Error('分组计划含非法或重复 group'); ids.add(g.id); } const old = new Set(model.groups.map((x) => x.id)); if ([...old].some((id) => !ids.has(id))) throw Error('groups apply 不得删除既有稳定 group ID'); const recordIds = new Set(model.records.map((x) => x.id)); if (Object.keys(plan.assignments).length !== recordIds.size || Object.keys(plan.assignments).some((id) => !recordIds.has(id))) throw Error('assignments 必须完整且仅覆盖现存记录'); for (const id of recordIds) { const target = plan.assignments[id]; if (target !== null && !ids.has(target)) throw Error(`记录 ${id} 指向未知分组`); } model.groups = plan.groups; model.store.group_dimension = plan.group_dimension; for (const record of model.records) record.group = plan.assignments[record.id]; save(model); return console.log('PSM_GROUPS_APPLIED'); } if (sub === 'rename') { const group = model.groups.find((x) => x.id === args[2]); if (!group) throw Error('未知分组'); group.title = opt('--title') || group.title; group.scope = opt('--scope') || group.scope; save(model); return console.log('PSM_GROUP_RENAMED'); } if (sub === 'move') { const target = opt('--to'); if (target !== null && !model.groups.some((x) => x.id === target)) throw Error('未知目标分组'); for (const id of (opt('--ids') || '').split(',').filter(Boolean)) find(model, id).group = target; save(model); return console.log('PSM_GROUP_MOVED'); } throw Error('未知 groups 子命令'); }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function legacySource() {
  const file = paths().legacy; const bytes = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  const text = bytes.toString('utf8'); const split = /(?:\r?\n)[ \t]*(?:\r?\n)/g; const items = []; let start = 0; let match;
  while ((match = split.exec(text))) { const raw = text.slice(start, match.index); if (raw.trim()) { const begin = Buffer.byteLength(text.slice(0, start)); const end = Buffer.byteLength(text.slice(0, match.index)); const segment = bytes.subarray(begin, end); items.push({ start: begin, end, bytes: segment, source_hash: sha(segment) }); } start = match.index + match[0].length; }
  const tail = text.slice(start); if (tail.trim()) { const begin = Buffer.byteLength(text.slice(0, start)); items.push({ start: begin, end: bytes.length, bytes: bytes.subarray(begin), source_hash: sha(bytes.subarray(begin)) }); }
  return { bytes, snapshot: sha(bytes), items };
}
function writePrepared(file, bytes) { const temp = `${file}.psm-${process.pid}-${Date.now()}.tmp`; fs.writeFileSync(temp, bytes); return temp; }
function legacy() { const sub = args[1]; const source = legacySource(); if (sub === 'scan') return json({ snapshot: source.snapshot, items: source.items.map((item, i) => ({ temporary_id: `U${String(i + 1).padStart(3, '0')}`, source_hash: item.source_hash, content: item.bytes.toString('utf8') })) }); if (sub !== 'migrate') throw Error('未知 legacy 子命令'); const plan = JSON.parse(fs.readFileSync(path.resolve(opt('--plan-file')), 'utf8')); if (plan.snapshot !== source.snapshot || !Array.isArray(plan.items)) throw Error('legacy 计划快照不匹配或缺少 items'); const seen = new Set();
  for (const item of plan.items) { const index = Number(String(item.temporary_id).slice(1)) - 1; const sourceItem = source.items[index]; if (!/^U\d{3,}$/.test(item.temporary_id) || seen.has(item.temporary_id)) throw Error('temporary_id 必须唯一'); seen.add(item.temporary_id); if (!sourceItem || sourceItem.source_hash !== item.source_hash) throw Error(`legacy 原始范围或 hash 不匹配: ${item.temporary_id}`); }
  const model = loadStore(); mustWritable(model); const removed = []; const result = [];
  for (const item of plan.items) { const index = Number(item.temporary_id.slice(1)) - 1; if (!TYPES.has(item.type) || !item.content || (item.group && !model.groups.some((x) => x.id === item.group))) { result.push({ temporary_id: item.temporary_id, ok: false, reason: '类型、正文或分组非法' }); continue; }
    const contractErrors = contentContractErrors(item.content);
    if (contractErrors.length) { result.push({ temporary_id: item.temporary_id, ok: false, reason: `新正文不符合单行契约：${contractErrors.join('；')}` }); continue; }
    const id = newId(model); model.records.push({ id, type: item.type, status: 'active', positive: 0, negative: 0, created_at: timestamp(), last_scored_at: '', content: String(item.content).trim(), group: item.group || null }); removed.push(source.items[index]); result.push({ temporary_id: item.temporary_id, ok: true, id }); }
  // Validate both output bytes before either durable replacement; legacy is renamed first so memory is never ahead of it.
  mustWritable(model); const newMemory = Buffer.from(serialize(model), 'utf8'); const pieces = []; let cursor = 0; for (const item of [...removed].sort((a, b) => a.start - b.start)) { pieces.push(source.bytes.subarray(cursor, item.start)); cursor = item.end; } pieces.push(source.bytes.subarray(cursor)); const newLegacy = Buffer.concat(pieces);
  const p = paths(); const legacyTemp = writePrepared(p.legacy, newLegacy); const memoryTemp = writePrepared(p.memory, newMemory); try { fs.renameSync(legacyTemp, p.legacy); fs.renameSync(memoryTemp, p.memory); } catch (e) { if (fs.existsSync(legacyTemp)) fs.unlinkSync(legacyTemp); if (fs.existsSync(memoryTemp)) fs.unlinkSync(memoryTemp); throw e; } json(result); }
function evidence() {
  const sub = args[1];
  if (sub === 'validate') return json(validateLedger(paths().root));
  if (sub === 'inspect') {
    return json(inspectLedger(paths().root, {
      event_id: opt('--event-id'), record_id: opt('--record-id'), record_version: opt('--record-version'),
    }));
  }
  if (sub === 'migrate') {
    const model = loadStore();
    const errors = writeErrors(model);
    if (errors.length) throw Error(`拒绝迁移损坏库: ${errors.map((x) => x.message).join('；')}`);
    initializeLedger(paths().root);
    const result = migrateLegacyScores(paths().root, model.records);
    save(model);
    return json(result);
  }
  if (sub === 'append') {
    const model = loadStore();
    mustWritable(model);
    const supplied = opt('--event-json');
    let payload = {};
    if (supplied) {
      try { payload = JSON.parse(supplied); } catch (error) { throw Error(`event-json 不是合法 JSON: ${error.message}`); }
    }
    const recordId = String(payload.record_id || payload.recordId || opt('--record-id') || '');
    if (!recordId) throw Error('evidence append 必须提供 --record-id');
    const record = find(model, recordId);
    const input = {
      ...payload,
      event_id: payload.event_id || opt('--event-id') || undefined,
      record_id: recordId,
      record_version: payload.record_version || payload.recordVersion || opt('--record-version') || recordVersion(record),
      task_id: payload.task_id || payload.taskId || opt('--task-id') || `manual-${process.pid}`,
      kind: payload.kind || opt('--kind') || '',
      observed_at: payload.observed_at || payload.observedAt || opt('--observed-at') || undefined,
      source: payload.source || opt('--source') || 'manual',
    };
    if (opt('--quantity') !== null) input.quantity = Number(opt('--quantity'));
    if (opt('--projection') !== null) {
      try { input.projection = JSON.parse(opt('--projection')); } catch (error) { throw Error(`projection 不是合法 JSON: ${error.message}`); }
    }
    const result = appendEvent(paths().root, input);
    save(model);
    return json(result);
  }
  throw Error('未知 evidence 子命令');
}
function config() {
  const sub = args[1]; const parsed = loadConfig();
  if (sub === 'show') return json({ ...parsed, auto_enabled: parsed.errors.length === 0 ? parsed.config : { auto_load: false, auto_save: false, auto_rate: false, load_mode: 'off' } });
  if (sub === 'validate') { if (parsed.errors.length) throw Error(parsed.errors.map((x) => x.message).join('；')); return console.log('PSM_CONFIG_VALID'); }
  if (sub === 'set') {
    if (parsed.errors.length) throw Error('配置损坏；先运行 config repair 或 reset');
    const key = args[2]; const value = args[3];
    if (!Object.hasOwn(CONFIG_DEFAULT, key) || value === undefined) throw Error('未知配置键或缺少值');
    const candidate = { ...parsed.config, [key]: value };
    const checked = parseConfig(configText({ ...parsed.config, [key]: key === 'version' || key.startsWith('max_') ? Number(value) : key.startsWith('min_') ? Number(value) : value }), false);
    if (checked.errors.length) throw Error(checked.errors.map((x) => x.message).join('；'));
    parsed.config[key] = checked.config[key]; fs.writeFileSync(paths().config, configText(parsed.config)); return console.log('PSM_CONFIG_UPDATED');
  }
  if (sub === 'reset') { fs.mkdirSync(paths().base, { recursive: true }); fs.writeFileSync(paths().config, configText(CONFIG_DEFAULT)); return console.log('PSM_CONFIG_RESET'); }
  if (sub === 'repair') {
    if (parsed.errors.some((x) => x.impact === 'fatal')) return json({ applied: false, repair_preview: { ...CONFIG_DEFAULT, auto_load: false, auto_save: false, auto_rate: false }, reason: parsed.errors.map((x) => x.message), apply: '运行 config reset 显式重置' });
    fs.mkdirSync(paths().base, { recursive: true }); fs.writeFileSync(paths().config, configText(parsed.config)); return console.log('PSM_CONFIG_REPAIRED');
  }
  throw Error('未知 config 子命令');
}
function main() { const command = args[0]; try { if (command === 'init') return initialize(); if (command === 'validate') return validate(); if (command === 'diagnose') return diagnose(); if (command === 'read') return read(); if (command === 'tags') return tagsCommand(); if (command === 'catalog') { validateLedger(paths().root); const model = loadStore(); const invalid = new Set(validateModel(model).filter((x) => x.kind === 'record').map((x) => x.id)); if (opt('--by') === 'tag') return json(tagCatalog(model.records.filter((r) => r.status === 'active' && !invalid.has(r.id)))); return json(model.groups.map((g) => ({ ...g, count: model.records.filter((r) => r.group === g.id && r.status === 'active' && !invalid.has(r.id)).length }))); } if (command === 'inspect') { const model = loadStore(); if (has('--legacy')) { const source=legacySource(); return json({ snapshot: source.snapshot, items: source.items.map((item, i) => ({ temporary_id: `U${String(i + 1).padStart(3, '0')}`, source_hash: item.source_hash, content: item.bytes.toString('utf8') })) }); } validateLedger(paths().root); if (/^\d/.test(args[1] || '')) return json(projectRecord(paths().root, find(model, args[1]))); if (has('--trim-candidates')) return json(model.records.map((r) => projectRecord(paths().root, r)).filter((r) => r.positive - r.negative < 0 || (r.negative >= 3 && r.negative >= r.positive))); return json(has('--groups') ? model.groups : model); } if (command === 'add') return add(); if (command === 'update') return update(); if (command === 'status') { const m=loadStore(); mustWritable(m); const r=find(m,args[1]); if(!STATUS.has(args[2])) throw Error('状态非法'); r.status=args[2]; save(m); return console.log(r.id); } if (command === 'delete') { const m=loadStore(); mustWritable(m); const ids=new Set((opt('--ids')||'').split(',').filter(Boolean)); m.records=m.records.filter((r)=>!ids.has(r.id)); save(m); return console.log('PSM_DELETED'); } if (command === 'score') return score('normal'); if (command === 'score-reset') return score('reset'); if (command === 'score-repair') return score('repair'); if (command === 'merge') return merge(); if (command === 'groups' || command === 'group') return groups(); if (command === 'legacy') return legacy(); if (command === 'evidence' || command === 'migrate-evidence') return evidence(); if (command === 'config') return config(); if (command === 'viewer') return viewerCommand(); if (command === 'migrate-schema') { const model=loadStore(); if(model.store?.version === '1') return console.log('PSM_NO_MIGRATION: 当前已是 v1，无可迁移前版'); throw Error('未知或未来结构化版本不能迁移'); } throw Error('未知命令'); } catch (e) { die(e.message); } }
main();
