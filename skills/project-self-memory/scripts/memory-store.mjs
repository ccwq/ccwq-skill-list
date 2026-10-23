#!/usr/bin/env node
/**
 * Shared store core for project-self-memory.
 *
 * memory.mjs (CLI) and the view-memoery.js builder both consume this module so
 * parsing, validation and serialization never drift between the two writers.
 * The module carries no process or network behaviour; callers inject the
 * project root and perform I/O themselves.
 */

export const TYPES = new Set(['experience', 'pitfall', 'decision', 'constraint', 'fact']);
export const STATUS = new Set(['active', 'review', 'disabled']);
export const TYPE_LABEL = { experience: '经验', pitfall: '避坑', decision: '决策', constraint: '约束', fact: '事实' };
export const RECORD_KEYS = ['id', 'type', 'status', 'positive', 'negative', 'created_at', 'last_scored_at'];
export const STORE_KEYS = ['version', 'next_id', 'group_dimension'];
export const GROUP_KEYS = ['id', 'scope'];

export function escapeXml(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function unescapeXml(value) { return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

// The format is XML-like, not XML. This deliberately rejects all XML features.
export function parseElement(line, name, required) {
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
export function canonicalId(value) { return /^(?:\d{4}|[1-9]\d{4,})$/.test(value); }
export function issue(kind, message, extra = {}) { return { kind, message, ...extra }; }

export function parseStore(text) {
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

export function validateModel(model) {
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
export function writeErrors(model) {
  const errors = validateModel(model);
  if (model.opaque) errors.push(issue('legacy', '活动 memory.md 含未结构化内容；拒绝写入以原样保留', { impact: 'fatal' }));
  return errors;
}

function attributes(item, keys) { return keys.map((key) => `${key}="${escapeXml(item[key] ?? '')}"`).join(' '); }

export function serialize(model) {
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
export function editGuard({ content, type, status }) {
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
export function contentContractErrors(content) {
  if (typeof content !== 'string') return ['正文必须是字符串'];
  const text = content.trim();
  if (!text) return ['正文必须是非空字符串'];
  if (/[\r\n\u2028\u2029]/.test(text)) return ['新正文必须单行：去除首尾空白后不得含内部换行（含 CRLF 与 Unicode 行/段分隔符）'];
  if (/<!--\s*<\/?\s*(psm|psm-store|psm-group)[\s/>]/.test(text)) return ['正文不得包含 psm 结构标记'];
  if (/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|```|~~~)/.test(text)) return ['新正文不得以 Markdown 标题、列表或代码围栏开头（单行存储要求）'];
  return [];
}

/** Shared single-line gate: throws with the deterministic reasons on failure. */
export function assertContentContract(content) {
  const errors = contentContractErrors(content);
  if (errors.length) throw Error(`PSM_CONTRACT: 新正文不符合单行契约 — ${errors.join('；')}`);
}

/** Canonical timestamp shared by CLI and viewer (UTC, second precision). */
export function timestamp() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

/**
 * Rule-based freshness estimate (mirror of memory-retrieval.mjs). It is an
 * estimate, not a verification verdict; the viewer labels it as such.
 * `nowMs` is injectable so tests can pin the clock.
 */
export function ruleFreshness(record, nowMs) {
  if (record.type === 'decision' || record.type === 'constraint') return 1;
  const date = record.last_scored_at || record.created_at;
  const at = Date.parse(String(date || ''));
  if (!Number.isFinite(at)) return 0.5;
  const ageDays = Math.max(0, (nowMs - at) / 86400000);
  const halfLife = record.type === 'fact' ? 45 : 90;
  return Math.max(0, Math.min(1, Math.exp(-Math.LN2 * ageDays / halfLife)));
}
