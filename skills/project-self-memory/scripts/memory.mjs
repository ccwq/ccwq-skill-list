#!/usr/bin/env node
/** Deterministic, dependency-free store manager for project-self-memory. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const TYPES = new Set(['experience', 'pitfall', 'decision', 'constraint', 'fact']);
const STATUS = new Set(['active', 'review', 'disabled']);
const TYPE_LABEL = { experience: '经验', pitfall: '避坑', decision: '决策', constraint: '约束', fact: '事实' };
const CONFIG_DEFAULT = { version: 1, auto_load: true, auto_save: true, auto_rate: true };
const RECORD_KEYS = ['id', 'type', 'status', 'positive', 'negative', 'created_at', 'last_scored_at'];
const STORE_KEYS = ['version', 'next_id', 'group_dimension'];
const GROUP_KEYS = ['id', 'scope'];
const raw = process.argv.slice(2);
const args = raw.filter((v, i) => v !== '--project-root' && raw[i - 1] !== '--project-root');
const opt = (name) => { const i = raw.indexOf(name); return i < 0 ? null : raw[i + 1]; };
const has = (name) => args.includes(name);
const timestamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const die = (message) => { console.error(`PSM_ERROR: ${message}`); process.exit(1); };
const json = (data) => console.log(JSON.stringify(data, null, 2));
function paths() { const root = path.resolve(opt('--project-root') || process.cwd()); const base = path.join(root, '.project-self-memory'); return { root, base, memory: path.join(base, 'memory.md'), config: path.join(base, 'config.yaml'), legacy: path.join(root, 'self-memory', 'memory.md') }; }
function escapeXml(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function unescapeXml(value) { return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function contentInput() { const file = opt('--content-file'); const value = file ? fs.readFileSync(path.resolve(file), 'utf8') : !process.stdin.isTTY ? fs.readFileSync(0, 'utf8') : null; if (!value?.trim()) throw Error('正文必须通过 --content-file 或标准输入提供'); return value.trim(); }

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
        let nextRecord; let nextGroup;
        try { nextRecord = parseElement(lines[i], 'psm', RECORD_KEYS); nextGroup = parseElement(lines[i], 'psm-group', GROUP_KEYS); } catch { nextRecord = null; nextGroup = null; }
        if (nextRecord || (isHeading(lines[i]) && nextGroup) || lines[i].trim().startsWith('<!-- <')) break;
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
function loadStore() { const file = paths().memory; if (!fs.existsSync(file)) throw Error('缺少 memory.md；先运行 init'); return parseStore(fs.readFileSync(file, 'utf8')); }
function writeErrors(model) { const errors = validateModel(model); if (model.opaque) errors.push(issue('legacy', '活动 memory.md 含未结构化内容；拒绝写入以原样保留', { impact: 'fatal' })); return errors; }
function mustWritable(model) { const errors = writeErrors(model); if (errors.length) throw Error(`拒绝写入损坏库: ${errors.map((x) => x.message).join('；')}`); }
function attributes(item, keys) { return keys.map((key) => `${key}="${escapeXml(item[key] ?? '')}"`).join(' '); }
function serialize(model) {
  let out = `<!-- <psm-store ${attributes(model.store, STORE_KEYS)} /> -->\n`;
  const emit = (record) => { out += `<!-- <psm ${attributes(record, RECORD_KEYS)} /> -->\n${record.content}\n\n`; };
  for (const record of model.records.filter((x) => !x.group)) emit(record);
  for (const group of model.groups) { out += `## ${group.title}\n<!-- <psm-group ${attributes(group, GROUP_KEYS)} /> -->\n\n`; for (const record of model.records.filter((x) => x.group === group.id)) emit(record); }
  return out;
}
function save(model) { mustWritable(model); fs.writeFileSync(paths().memory, serialize(model)); }
function find(model, id) { const record = model.records.find((x) => x.id === id); if (!record) throw Error(`不存在记录: ${id}`); return record; }
function newId(model) { const id = model.store.next_id; model.store.next_id = (BigInt(id) + 1n).toString().padStart(id.length, '0'); return id; }

function configText(config) { return `# project-self-memory 自动化配置，仅控制行为，不保存经验。\n# 请通过 memory.mjs config 命令修改。\nversion: ${config.version}\n\nauto_load: ${config.auto_load}\nauto_save: ${config.auto_save}\nauto_rate: ${config.auto_rate}\n`; }
function parseConfig(text, allowMissing = false) {
  const out = {}; const errors = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) { const s = line.trim(); if (!s || s.startsWith('#')) continue; const m = s.match(/^([a-z_]+):\s*(\S+)\s*$/); if (!m || !Object.hasOwn(CONFIG_DEFAULT, m[1]) || Object.hasOwn(out, m[1])) { errors.push(issue('config', `配置非法、重复或未知键: ${s}`, { line: index + 1, impact: 'fatal' })); continue; } if (m[1] === 'version') out.version = Number(m[2]); else if (m[2] === 'true' || m[2] === 'false') out[m[1]] = m[2] === 'true'; else errors.push(issue('config', `布尔值只能为 true/false: ${m[1]}`, { line: index + 1, impact: 'fatal' })); }
  if (out.version !== undefined && out.version !== 1) errors.push(issue('config', 'version 必须为 1', { impact: 'fatal' }));
  const missing = Object.keys(CONFIG_DEFAULT).filter((key) => !Object.hasOwn(out, key));
  if (!allowMissing && missing.length) errors.push(issue('config', `缺少配置键: ${missing.join(', ')}`, { impact: 'repairable' }));
  return { config: { ...CONFIG_DEFAULT, ...out }, errors, missing };
}
function loadConfig() { const file = paths().config; if (!fs.existsSync(file)) return { config: CONFIG_DEFAULT, errors: [issue('config', '缺少 config.yaml', { impact: 'repairable' })], missing: Object.keys(CONFIG_DEFAULT) }; return parseConfig(fs.readFileSync(file, 'utf8')); }
function initialize() { const p = paths(); fs.mkdirSync(p.base, { recursive: true }); if (!fs.existsSync(p.config)) fs.writeFileSync(p.config, configText(CONFIG_DEFAULT)); if (!fs.existsSync(p.memory)) fs.writeFileSync(p.memory, '<!-- <psm-store version="1" next_id="0001" group_dimension="" /> -->\n'); console.log('PSM_INITIALIZED'); }

function validate() { const config = loadConfig(); let store; try { store = loadStore(); } catch (e) { die(e.message); } const errors = [...config.errors, ...validateModel(store)]; if (errors.length) die(errors.map((x) => `${x.kind}: ${x.message}`).join('\n')); console.log('PSM_VALID'); }
function diagnose() { const config = loadConfig(); let model; try { model = loadStore(); } catch (e) { return json({ config: config.errors, store: [issue('store', e.message, { impact: 'fatal' })], group: [], record: [], legacy: [], valid_records: 0, write_safe: false }); } const errors = writeErrors(model); const by = (kind) => errors.filter((x) => x.kind === kind); const badIds = new Set(by('record').map((x) => x.id)); json({ config: config.errors, store: by('store'), group: by('group'), record: by('record'), legacy: model.legacy.map((content, index) => ({ line: index + 1, content })), valid_records: Math.max(0, model.records.filter((x) => !badIds.has(x.id)).length), write_safe: errors.length === 0 }); }
function read() { const model = loadStore(); const errors = validateModel(model); if (errors.some((x) => x.impact === 'fatal')) die(errors.map((x) => x.message).join('；')); const invalid = new Set(errors.filter((x) => x.kind === 'record').map((x) => x.id)); const wanted = new Set((opt('--ids') || '').split(',').filter(Boolean)); const wantedGroups = new Set((opt('--group') || '').split(',').filter(Boolean)); const type = opt('--type'); const visible = model.records.filter((x) => x.status === 'active' && !invalid.has(x.id) && (!wanted.size || wanted.has(x.id)) && (!wantedGroups.size || wantedGroups.has(x.group)) && (!type || x.type === type)); let lastGroup = Symbol('none'); for (const record of visible) { if (record.group !== lastGroup) { const group = model.groups.find((x) => x.id === record.group); if (group) console.log(`## ${group.title}`); lastGroup = record.group; } console.log(`[${record.id}][${TYPE_LABEL[record.type]}] ${record.content}`); } }
function add() { const type = opt('--type'); if (!TYPES.has(type)) throw Error('--type 必须是合法类型'); const model = loadStore(); mustWritable(model); const group = opt('--group'); if (group && !model.groups.some((x) => x.id === group)) throw Error(`未知分组: ${group}`); const id = newId(model); model.records.push({ id, type, status: 'active', positive: 0, negative: 0, created_at: timestamp(), last_scored_at: '', content: contentInput(), group }); save(model); console.log(id); }
function update() { const model = loadStore(); mustWritable(model); const record = find(model, args[1]); record.content = contentInput(); if (!has('--keep-score')) { record.positive = 0; record.negative = 0; record.last_scored_at = ''; } save(model); console.log(record.id); }
function score(mode) { const model = loadStore(); mustWritable(model); const record = find(model, args[1]); if (mode === 'reset') { record.positive = 0; record.negative = 0; record.last_scored_at = ''; } else if (mode === 'repair') { record.positive = Number(opt('--positive')); record.negative = Number(opt('--negative')); if (!Number.isInteger(record.positive) || record.positive < 0 || !Number.isInteger(record.negative) || record.negative < 0) throw Error('评分必须为非负整数'); } else { const vote = args[2]; if (vote !== '+1' && vote !== '-1') throw Error('日常评分只接受 +1 或 -1'); if (vote === '+1') record.positive++; else record.negative++; record.last_scored_at = timestamp(); } save(model); json(record); }
function merge() { const model = loadStore(); mustWritable(model); const keep = opt('--keep'); const remove = opt('--remove'); if (!keep || !remove || keep === remove) throw Error('merge 的 keep 与 remove 必须为两个不同 ID'); if (BigInt(keep) >= BigInt(remove)) throw Error('keep 必须是较早的永久 ID'); const record = find(model, keep); find(model, remove); record.content = contentInput(); record.positive = 0; record.negative = 0; record.last_scored_at = ''; model.records = model.records.filter((x) => x.id !== remove); save(model); console.log(keep); }
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
  for (const item of plan.items) { const index = Number(item.temporary_id.slice(1)) - 1; if (!TYPES.has(item.type) || !item.content || (item.group && !model.groups.some((x) => x.id === item.group))) { result.push({ temporary_id: item.temporary_id, ok: false, reason: '类型、正文或分组非法' }); continue; } const id = newId(model); model.records.push({ id, type: item.type, status: 'active', positive: 0, negative: 0, created_at: timestamp(), last_scored_at: '', content: item.content, group: item.group || null }); removed.push(source.items[index]); result.push({ temporary_id: item.temporary_id, ok: true, id }); }
  // Validate both output bytes before either durable replacement; legacy is renamed first so memory is never ahead of it.
  mustWritable(model); const newMemory = Buffer.from(serialize(model), 'utf8'); const pieces = []; let cursor = 0; for (const item of [...removed].sort((a, b) => a.start - b.start)) { pieces.push(source.bytes.subarray(cursor, item.start)); cursor = item.end; } pieces.push(source.bytes.subarray(cursor)); const newLegacy = Buffer.concat(pieces);
  const p = paths(); const legacyTemp = writePrepared(p.legacy, newLegacy); const memoryTemp = writePrepared(p.memory, newMemory); try { fs.renameSync(legacyTemp, p.legacy); fs.renameSync(memoryTemp, p.memory); } catch (e) { if (fs.existsSync(legacyTemp)) fs.unlinkSync(legacyTemp); if (fs.existsSync(memoryTemp)) fs.unlinkSync(memoryTemp); throw e; } json(result); }
function config() { const sub = args[1]; const parsed = loadConfig(); if (sub === 'show') return json({ ...parsed, auto_enabled: parsed.errors.length === 0 ? parsed.config : { auto_load: false, auto_save: false, auto_rate: false } }); if (sub === 'validate') { if (parsed.errors.length) throw Error(parsed.errors.map((x) => x.message).join('；')); return console.log('PSM_CONFIG_VALID'); } if (sub === 'set') { if (parsed.errors.length) throw Error('配置损坏；先运行 config repair 或 reset'); const key = args[2]; const value = args[3]; if (!['auto_load', 'auto_save', 'auto_rate'].includes(key) || !['true', 'false'].includes(value)) throw Error('仅可设置自动行为为 true/false'); parsed.config[key] = value === 'true'; fs.writeFileSync(paths().config, configText(parsed.config)); return console.log('PSM_CONFIG_UPDATED'); } if (sub === 'reset') { fs.mkdirSync(paths().base, { recursive: true }); fs.writeFileSync(paths().config, configText(CONFIG_DEFAULT)); return console.log('PSM_CONFIG_RESET'); } if (sub === 'repair') { if (parsed.errors.some((x) => x.impact === 'fatal')) return json({ applied: false, repair_preview: { ...CONFIG_DEFAULT, auto_load: false, auto_save: false, auto_rate: false }, reason: parsed.errors.map((x) => x.message), apply: '运行 config reset 显式重置' }); fs.mkdirSync(paths().base, { recursive: true }); fs.writeFileSync(paths().config, configText(parsed.config)); return console.log('PSM_CONFIG_REPAIRED'); } throw Error('未知 config 子命令'); }
function main() { const command = args[0]; try { if (command === 'init') return initialize(); if (command === 'validate') return validate(); if (command === 'diagnose') return diagnose(); if (command === 'read') return read(); if (command === 'catalog') { const model = loadStore(); const invalid = new Set(validateModel(model).filter((x) => x.kind === 'record').map((x) => x.id)); return json(model.groups.map((g) => ({ ...g, count: model.records.filter((r) => r.group === g.id && r.status === 'active' && !invalid.has(r.id)).length }))); } if (command === 'inspect') { const model = loadStore(); if (/^\d/.test(args[1] || '')) return json(find(model, args[1])); if (has('--legacy')) { const source=legacySource(); return json({ snapshot: source.snapshot, items: source.items.map((item, i) => ({ temporary_id: `U${String(i + 1).padStart(3, '0')}`, source_hash: item.source_hash, content: item.bytes.toString('utf8') })) }); } if (has('--trim-candidates')) return json(model.records.filter((r) => r.positive - r.negative < 0 || (r.negative >= 3 && r.negative >= r.positive))); return json(has('--groups') ? model.groups : model); } if (command === 'add') return add(); if (command === 'update') return update(); if (command === 'status') { const m=loadStore(); mustWritable(m); const r=find(m,args[1]); if(!STATUS.has(args[2])) throw Error('状态非法'); r.status=args[2]; save(m); return console.log(r.id); } if (command === 'delete') { const m=loadStore(); mustWritable(m); const ids=new Set((opt('--ids')||'').split(',').filter(Boolean)); m.records=m.records.filter((r)=>!ids.has(r.id)); save(m); return console.log('PSM_DELETED'); } if (command === 'score') return score('normal'); if (command === 'score-reset') return score('reset'); if (command === 'score-repair') return score('repair'); if (command === 'merge') return merge(); if (command === 'groups' || command === 'group') return groups(); if (command === 'legacy') return legacy(); if (command === 'config') return config(); if (command === 'migrate-schema') { const model=loadStore(); if(model.store?.version === '1') return console.log('PSM_NO_MIGRATION: 当前已是 v1，无可迁移前版'); throw Error('未知或未来结构化版本不能迁移'); } throw Error('未知命令'); } catch (e) { die(e.message); } }
main();
