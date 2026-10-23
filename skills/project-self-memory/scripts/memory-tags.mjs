/** Optional, derived topic metadata. Never changes memory.md or evidence versions. */
import fs from 'node:fs';
import path from 'node:path';

export const TAG_LIMIT = 8;
export const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]*(:[a-z0-9][a-z0-9_.-]*)?$/;
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

export function normaliseTaxonomy(value = { version: 1, tags: [], overrides: {} }) {
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

export function deriveTags(record, taxonomy = normaliseTaxonomy()) {
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

export function loadTagTaxonomy(projectRoot) {
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

export function tagRecords(records, loaded) {
  return records.map((record) => ({ ...record, tags: loaded.enabled ? deriveTags(record, loaded.taxonomy) : [] }));
}

/** Conservative suggestions: existing prefixes and recurring identifier tokens. */
export function suggestTaxonomy(records, loaded = { taxonomy: normaliseTaxonomy(), enabled: true }) {
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
