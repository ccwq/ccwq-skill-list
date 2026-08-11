/**
 * Deterministic, body-safe context retrieval for MemorySession.
 *
 * This module intentionally contains no filesystem or shell access. The host
 * supplies structured records obtained through the memory CLI and receives a
 * bounded selection plus a body-free audit.
 */

export const RETRIEVAL_VERSION = 'retrieval-v1';

// These are explicit compatibility defaults for older config.yaml files. They
// are deliberately bounded and use relevant mode; they never mean implicit
// "all" loading when a task supplies searchable context.
export const DEFAULT_RETRIEVAL = Object.freeze({
  load_mode: 'relevant',
  max_context_tokens: 4096,
  max_records: 24,
  min_confidence: 0,
  min_utility: 0,
  min_freshness: 0,
});

const LOAD_MODES = new Set(['off', 'relevant', 'all']);
const TYPE_LABEL = Object.freeze({
  experience: '经验', pitfall: '避坑', decision: '决策', constraint: '约束', fact: '事实',
});
const WORD_RE = /[\p{L}\p{N}_-]+/gu;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const integer = (value) => Number.isSafeInteger(value);

function invalid(name, message) {
  throw new TypeError(`${name} ${message}`);
}

export function normaliseRetrievalOptions(value, name = 'retrieval') {
  if (value === undefined || value === null) return { ...DEFAULT_RETRIEVAL };
  if (!isObject(value)) invalid(name, '必须是对象');
  const result = { ...DEFAULT_RETRIEVAL };
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(DEFAULT_RETRIEVAL, key)) invalid(name, `含未知键: ${key}`);
    result[key] = value[key];
  }
  if (!LOAD_MODES.has(result.load_mode)) invalid(`${name}.load_mode`, '必须为 off、relevant 或 all');
  for (const key of ['max_context_tokens', 'max_records']) {
    if (!integer(result[key]) || result[key] < 1 || result[key] > 10000000) invalid(`${name}.${key}`, '必须是 1..10000000 的安全整数');
  }
  for (const key of ['min_confidence', 'min_utility', 'min_freshness']) {
    if (!finite(result[key]) || result[key] < 0 || result[key] > 1) invalid(`${name}.${key}`, '必须是 0..1 的数字');
  }
  return result;
}

/** Parse the JSON returned by `memory.mjs inspect` without accepting bodies from logs. */
export function parseStructuredStore(output) {
  let value;
  try { value = JSON.parse(String(output || '').trim()); } catch (error) {
    throw new Error(`结构化 memory inspect 输出非法: ${error.message}`);
  }
  const model = isObject(value?.model) ? value.model : value;
  if (!isObject(model) || !Array.isArray(model.records)) throw new Error('结构化 memory inspect 缺少 records');
  return model;
}

function words(value) {
  return new Set(String(value || '').toLocaleLowerCase().match(WORD_RE) || []);
}

function taskTerms(task) {
  if (typeof task === 'string') return words(task);
  if (!isObject(task)) return new Set();
  const values = [];
  for (const key of ['query', 'goal', 'objective', 'description', 'title', 'task']) {
    if (typeof task[key] === 'string') values.push(task[key]);
  }
  for (const key of ['keywords', 'tags']) {
    if (Array.isArray(task[key])) values.push(task[key].join(' '));
    else if (typeof task[key] === 'string') values.push(task[key]);
  }
  return words(values.join(' '));
}

function recordTerms(record) {
  return words([record.type, record.group, record.content].filter(Boolean).join(' '));
}

function relevance(record, task) {
  const terms = taskTerms(task);
  if (!terms.size) return { score: 0.5, matched: 0, hasTask: false };
  const candidate = recordTerms(record);
  const candidateText = [record.type, record.group, record.content].filter(Boolean).join(' ').toLocaleLowerCase();
  let matched = 0;
  for (const term of terms) if (candidate.has(term) || candidateText.includes(term)) matched += 1;
  return { score: matched / terms.size, matched, hasTask: true };
}

function projectedRatio(positive, negative) {
  const p = integer(positive) && positive >= 0 ? positive : 0;
  const n = integer(negative) && negative >= 0 ? negative : 0;
  // A beta(1,1) prior prevents one lucky event from dominating long history.
  return (p + 1) / (p + n + 2);
}

function freshness(record, nowMs) {
  if (finite(record.freshness)) return clamp(record.freshness);
  if (record.type === 'decision' || record.type === 'constraint') return 1;
  const date = record.last_verified_at || record.lastVerifiedAt || record.last_scored_at
    || record.updated_at || record.created_at;
  const at = Date.parse(String(date || ''));
  if (!Number.isFinite(at)) return 0.5;
  const ageDays = Math.max(0, (nowMs - at) / 86400000);
  const halfLife = record.type === 'fact' ? 45 : 90;
  return clamp(Math.exp(-Math.LN2 * ageDays / halfLife));
}

function metrics(record, task, nowMs) {
  const rel = relevance(record, task);
  const confidence = finite(record.confidence)
    ? clamp(record.confidence)
    : projectedRatio(record.positive, record.negative);
  const utility = finite(record.utility)
    ? clamp(record.utility)
    : projectedRatio(record.positive, record.negative);
  const fresh = freshness(record, nowMs);
  // Relevance is intentionally the dominant term; it cannot be rescued by a
  // high historical score because zero-relevance candidates are filtered.
  const rank = rel.score * 0.55 + confidence * 0.2 + utility * 0.15 + fresh * 0.1;
  return { ...rel, confidence, utility, freshness: fresh, rank };
}

export function estimateTokens(text) {
  // Conservative deterministic upper bound for environments without a tokenizer.
  return Math.ceil(String(text || '').length / 3);
}

function contextLine(record) {
  const label = TYPE_LABEL[record.type] || String(record.type || '记忆');
  return `[${record.id}][${label}] ${record.content}`;
}

function countReason(excluded, reason) {
  excluded[reason] = (excluded[reason] || 0) + 1;
}

function safeRecord(record, calculated) {
  const source = {
    kind: 'memory-store',
    evidence_events: integer(record.event_count) && record.event_count >= 0 ? record.event_count : 0,
  };
  if (typeof record.last_scored_at === 'string' && record.last_scored_at) source.last_scored_at = record.last_scored_at;
  return Object.freeze({
    id: String(record.id), type: String(record.type), type_label: TYPE_LABEL[record.type] || String(record.type),
    status: 'active', group: record.group ?? null, content: String(record.content).trim(),
    record_version: typeof record.record_version === 'string' ? record.record_version : undefined,
    confidence: calculated.confidence, utility: calculated.utility, freshness: calculated.freshness,
    relevance: calculated.score, source_summary: source,
  });
}

/**
 * Select bounded context records. The returned audit never contains record
 * content or arbitrary input fields.
 */
export function selectMemoryContext(records, options = {}, task = {}, now = Date.now()) {
  const config = normaliseRetrievalOptions(options);
  const excluded = {};
  const sourceRecords = Array.isArray(records) ? records : [];
  const audit = {
    strategy_version: RETRIEVAL_VERSION, mode: config.load_mode,
    candidate_count: sourceRecords.length, eligible_count: 0, selected_count: 0,
    estimated_tokens: 0, max_context_tokens: config.max_context_tokens, max_records: config.max_records,
    excluded, excluded_reason_counts: excluded,
    diversity: { groups: 0, max_per_group: null }, selected_ids: [],
  };
  if (config.load_mode === 'off') {
    for (const record of sourceRecords) countReason(excluded, record?.status === 'review' || record?.status === 'disabled' ? `status-${record.status}` : 'policy-off');
    return { records: [], memoryContext: '', audit };
  }

  const candidates = [];
  for (const record of sourceRecords) {
    if (!isObject(record) || !record.id || !record.type || typeof record.content !== 'string' || !record.content.trim()) {
      countReason(excluded, 'invalid-record'); continue;
    }
    if (record.status !== 'active') { countReason(excluded, `status-${record.status || 'unknown'}`); continue; }
    const calculated = metrics(record, task, now);
    if (config.load_mode === 'relevant' && calculated.hasTask && calculated.score <= 0) { countReason(excluded, 'low-relevance'); continue; }
    if (calculated.confidence < config.min_confidence) { countReason(excluded, 'low-confidence'); continue; }
    if (calculated.utility < config.min_utility) { countReason(excluded, 'low-utility'); continue; }
    if (calculated.freshness < config.min_freshness) { countReason(excluded, 'stale'); continue; }
    candidates.push({ record, calculated, line: contextLine(record) });
  }
  audit.eligible_count = candidates.length;
  candidates.sort((a, b) => b.calculated.rank - a.calculated.rank || String(a.record.id).localeCompare(String(b.record.id)));

  const groups = new Map();
  for (const candidate of candidates) {
    const key = candidate.record.group || '__ungrouped__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  audit.diversity.groups = groups.size;
  const maxPerGroup = groups.size > 1 ? Math.max(1, Math.ceil(config.max_records / Math.min(groups.size, 3))) : config.max_records;
  audit.diversity.max_per_group = maxPerGroup;
  const selected = [];
  const groupCounts = new Map();
  let estimated = 0;
  let progress = true;
  while (selected.length < config.max_records && progress) {
    progress = false;
    for (const [group, list] of groups) {
      if (selected.length >= config.max_records) break;
      if ((groupCounts.get(group) || 0) >= maxPerGroup) {
        while (list.length && list[0].__seen) list.shift();
        continue;
      }
      const candidate = list.find((item) => !item.__seen);
      if (!candidate) continue;
      candidate.__seen = true;
      const addTokens = estimateTokens(selected.length ? `${candidate.line}\n\n` : candidate.line);
      if (estimated + addTokens > config.max_context_tokens) { countReason(excluded, 'budget'); continue; }
      selected.push(candidate); estimated += addTokens;
      groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
      progress = true;
    }
  }
  for (const candidate of candidates) {
    if (!candidate.__seen) {
      const group = candidate.record.group || '__ungrouped__';
      if ((groupCounts.get(group) || 0) >= maxPerGroup && groups.size > 1) countReason(excluded, 'diversity-cap');
      else countReason(excluded, 'budget');
    }
  }
  audit.selected_count = selected.length;
  audit.estimated_tokens = estimated;
  const output = selected.map(({ record, calculated }) => safeRecord(record, calculated));
  audit.selected_ids = output.map((item) => item.id);
  return { records: output, memoryContext: selected.map((candidate) => candidate.line).join('\n\n'), audit };
}

export const retrieveMemoryContext = selectMemoryContext;
export const estimateTokenCount = estimateTokens;
export const validateRetrievalConfig = normaliseRetrievalOptions;

export default selectMemoryContext;
