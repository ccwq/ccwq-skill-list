/**
 * Host-owned automatic memory lifecycle.
 *
 * This module deliberately does not sandbox the host or Codex Shell. It only
 * provides the memory capability seam which an Agent task runner can embed.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RETRIEVAL,
  normaliseRetrievalOptions,
  parseStructuredStore,
  selectMemoryContext,
} from './memory-retrieval.mjs';
import { recordVersion } from './evidence-ledger.mjs';

const DEFAULT_POLICY = Object.freeze({ auto_load: true, auto_save: true, auto_rate: true });
const POLICY_KEYS = Object.keys(DEFAULT_POLICY);
const READ_LABELS = new Set(['经验', '避坑', '决策', '约束', '事实']);

const now = () => new Date().toISOString();
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const stableId = (value) => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex').slice(0, 48);

function hasDirectHostOutcome(evidence) {
  // These fields are structured observations emitted by the host adapter. A
  // free-form Agent claim is never enough to earn an automatic positive score.
  const hostConfirmed = evidence.host_confirmed === true || evidence.hostConfirmed === true;
  const directlyAttributable = evidence.direct_causal === true || evidence.directCausal === true;
  const directAdoption = evidence.direct_adoption === true || evidence.directAdoption === true
    || evidence.directly_adopted === true || evidence.directlyAdopted === true;
  const directResult = evidence.direct_result === true || isObject(evidence.direct_result)
    || evidence.directResult === true || isObject(evidence.directResult);
  return directlyAttributable || (hostConfirmed && (directAdoption || directResult));
}

function normaliseOverrides(value, name) {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new TypeError(`${name} 必须是对象`);
  const result = {};
  for (const key of POLICY_KEYS) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== 'boolean') throw new TypeError(`${name}.${key} 必须是 boolean`);
      result[key] = value[key];
    }
  }
  return result;
}

function retrievalOverrides(value, name) {
  if (value === undefined || value === null) return {};
  const normalised = normaliseRetrievalOptions(value, name);
  return Object.fromEntries(Object.keys(DEFAULT_RETRIEVAL)
    .filter((key) => Object.hasOwn(value, key)).map((key) => [key, normalised[key]]));
}

function parseReadOutput(output) {
  const records = [];
  let current = null;
  for (const line of String(output || '').replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^\[(\d+)\]\[([^\]]+)\]\s?(.*)$/);
    if (match && READ_LABELS.has(match[2])) {
      if (current) records.push(current);
      current = { id: match[1], type_label: match[2], content: match[3] };
    } else if (current) {
      current.content += `\n${line}`;
    }
  }
  if (current) records.push(current);
  return records.map((record) => ({ ...record, content: record.content.trim() }));
}

function defaultRunner({ node, cliPath, projectRoot, args, input }) {
  const result = spawnSync(node, [cliPath, ...args, '--project-root', projectRoot], {
    encoding: 'utf8', input, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    const error = new Error(detail);
    error.code = result.status;
    throw error;
  }
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
}

/**
 * One resolved policy and lifecycle seam per Agent task.
 */
export class MemorySession {
  constructor(options = {}) {
    if (!isObject(options)) throw new TypeError('options 必须是对象');
    this.projectRoot = path.resolve(options.projectRoot || process.cwd());
    this.cliPath = path.resolve(options.cliPath || path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory.mjs'));
    this.node = options.node || process.execPath;
    this.sessionOverrides = normaliseOverrides(options.sessionOverrides || options.policy, 'sessionOverrides');
    this.retrievalOverrides = retrievalOverrides(options.retrieval || options.retrievalPolicy || options.contextPolicy, 'retrieval');
    this.runCli = options.runCli || defaultRunner;
    this.agent = options.agent || null;
    this.onAudit = typeof options.onAudit === 'function' ? options.onAudit : options.audit?.emit;
    this.auditEvents = [];
    this.loadedRecords = new Map();
    this.positiveEvidence = new Set();
    this.ratedRecords = new Set();
    this.structuredEvidence = new Map();
    this.legacyPositiveEvidence = new Set();
    this.taskId = null;
    this.policy = null;
    this.started = false;
    this.ended = false;
  }

  emit(action, allowed, reason, extra = {}) {
    const event = {
      event: `memory.${action}`, action, outcome: allowed ? 'allowed' : (action === 'policy-resolution-failure' ? 'failed' : 'blocked'),
      allowed: Boolean(allowed), reason, at: now(), ...extra,
    };
    // Never include candidate bodies, memory content, or arbitrary user payloads.
    delete event.content;
    delete event.body;
    this.auditEvents.push(event);
    if (this.onAudit) this.onAudit(Object.freeze({ ...event }));
    return event;
  }

  resolvePolicy(taskOverrides, taskRetrieval, maintenance = false) {
    const task = normaliseOverrides(taskOverrides, 'taskOverrides');
    let config = { ...DEFAULT_POLICY };
    try {
      const result = this.runCli({ node: this.node, cliPath: this.cliPath, projectRoot: this.projectRoot, args: ['config', 'show'] });
      const parsed = JSON.parse(result.stdout);
      if (!isObject(parsed?.config) || parsed.errors?.length || parsed.missing?.length) throw new Error('配置无效');
      for (const key of POLICY_KEYS) {
        if (typeof parsed.config[key] !== 'boolean') throw new Error(`配置 ${key} 无效`);
        config[key] = parsed.config[key];
      }
      const configRetrieval = {};
      for (const key of Object.keys(DEFAULT_RETRIEVAL)) {
        if (Object.hasOwn(parsed.config, key)) configRetrieval[key] = parsed.config[key];
      }
      const retrieval = normaliseRetrievalOptions({
        ...DEFAULT_RETRIEVAL,
        ...configRetrieval,
        ...this.retrievalOverrides,
        ...retrievalOverrides(taskRetrieval, 'taskRetrieval'),
      }, 'retrieval');
      if (retrieval.load_mode === 'all' && maintenance !== true) {
        throw new Error('load_mode=all 仅允许显式 maintenance 用途');
      }
      return { ...DEFAULT_POLICY, ...config, ...this.sessionOverrides, ...task,
        retrieval, failClosed: false };
    } catch (error) {
      this.emit('policy-resolution-failure', false, 'invalid-or-unavailable-config', { outcome: 'failed' });
      return { auto_load: false, auto_save: false, auto_rate: false, failClosed: true };
    }
  }

  /** Begin one task; task overrides are resolved exactly once here. */
  async beginTask(task = {}) {
    if (this.started) throw new Error('MemorySession 只能 beginTask 一次');
    if (!isObject(task)) throw new TypeError('task 必须是对象');
    this.started = true;
    const taskOverrides = task.policy || task.overrides || (POLICY_KEYS.some((key) => Object.hasOwn(task, key)) ? task : undefined);
    const inlineRetrieval = Object.fromEntries(Object.keys(DEFAULT_RETRIEVAL)
      .filter((key) => Object.hasOwn(task, key)).map((key) => [key, task[key]]));
    const taskRetrieval = task.retrieval || task.retrievalPolicy || (Object.keys(inlineRetrieval).length ? inlineRetrieval : undefined);
    const taskContext = task.context || task.task || task.taskContext || task.currentTask || task.query || task;
    this.taskId = String(task.task_id || task.taskId || task.id || `task-${stableId(taskContext)}`);
    this.policy = Object.freeze(this.resolvePolicy(taskOverrides, taskRetrieval, task.maintenance === true || task.purpose === 'maintenance'));
    let records = [];
    let selection = selectMemoryContext([], { ...DEFAULT_RETRIEVAL, ...(this.policy.retrieval || {}), load_mode: 'off' }, taskContext);
    const hasAutomaticHook = this.policy.auto_load || this.policy.auto_save || this.policy.auto_rate;
    if (hasAutomaticHook) {
      try {
        // Host-owned read-only safety gate. The host must also avoid granting
        // shell/filesystem access to the Agent; this seam only returns memory.
        this.runCli({ node: this.node, cliPath: this.cliPath, projectRoot: this.projectRoot, args: ['validate'] });
      } catch {
        this.policy = Object.freeze({ ...this.policy, auto_load: false, auto_save: false, auto_rate: false, failClosed: true });
        this.emit('load', false, 'store-validation-failure');
      }
    }
    if (!this.policy.auto_load) {
      this.emit('load', false, this.policy.failClosed ? 'fail-closed' : 'policy-disabled');
      this.emit('selection', false, this.policy.failClosed ? 'fail-closed' : 'policy-disabled', { selectionAudit: selection.audit });
    } else {
      try {
        // Keep a human-readable read as a host-side safety check. It is never
        // parsed into Agent context; structured metadata comes from inspect.
        this.runCli({ node: this.node, cliPath: this.cliPath, projectRoot: this.projectRoot, args: ['read'] });
        const result = this.runCli({ node: this.node, cliPath: this.cliPath, projectRoot: this.projectRoot, args: ['inspect'] });
        const model = parseStructuredStore(result.stdout);
        const enrichedRecords = model.records.map((record) => ({
          ...record,
          record_version: record.record_version || recordVersion(record),
        }));
        selection = selectMemoryContext(enrichedRecords, this.policy.retrieval, taskContext);
        records = selection.records;
        for (const record of records) this.loadedRecords.set(record.id, record);
        this.emit('load', true, 'policy-enabled', { count: records.length, selectionAudit: selection.audit });
        this.emit('selection', true, 'policy-enabled', { selectionAudit: selection.audit });
      } catch {
        this.policy = Object.freeze({ ...this.policy, auto_load: false, auto_save: false, auto_rate: false, failClosed: true });
        this.emit('load', false, 'store-validation-or-read-failure');
        this.emit('selection', false, 'store-validation-or-read-failure', { selectionAudit: selection.audit });
      }
    }
    const capabilities = Object.freeze({
      memoryContext: Boolean(this.policy.auto_load && !this.policy.failClosed),
      directMemoryStore: false,
      directMemoryCli: false,
      shell: false,
      filesystem: false,
      manualMaintenance: false,
    });
    const payload = {
      memory: records,
      memoryContext: selection.memoryContext,
      selectionAudit: selection.audit,
      capabilities,
      policy: this.policy,
    };
    const tools = Object.freeze({ capabilities, invokeMemory: undefined });
    if (this.agent?.run) this.agentResult = await this.agent.run(Object.freeze(payload), tools);
    return Object.freeze(payload);
  }

  /** Record structured evidence; durable idempotency is delegated to the ledger. */
  recordEvidence(evidence = {}, options = {}) {
    if (!this.started || this.ended) throw new Error('MemorySession 当前不在可记录状态');
    if (!isObject(evidence)) throw new TypeError('evidence 必须是对象');
    const hostProvided = options?.hostProvided !== false;
    const id = String(evidence.refid || evidence.id || evidence.recordId || '');
    const loaded = id ? this.loadedRecords.get(id) : null;
    if (!loaded) return false;
    // Keep the historical positive shape as a compatibility input, but route
    // it through the same durable event path with a deterministic task id.
    const legacy = evidence.kind === undefined && evidence.positive === true;
    let kind = legacy ? 'applied_success' : String(evidence.kind || '');
    if (!['applied_success', 'applied_failure', 'still_valid', 'review_candidate'].includes(kind)) return false;
    const source = String(evidence.source || 'automatic');
    if (source !== 'automatic' && source !== 'system') return false;
    const version = String(evidence.record_version || evidence.recordVersion || loaded.record_version || '');
    if (!version || version !== loaded.record_version) return false;
    const suppliedTaskId = evidence.task_id ?? evidence.taskId;
    if (suppliedTaskId !== undefined && String(suppliedTaskId) !== this.taskId) return false;
    const taskId = String(this.taskId || '');
    if (!taskId) return false;
    if (kind === 'applied_failure' && evidence.direct_causal !== true && evidence.directCausal !== true) kind = 'review_candidate';
    if ((kind === 'applied_success' || kind === 'still_valid')
      && (!hostProvided || !hasDirectHostOutcome(evidence))) kind = 'review_candidate';
    const event = {
      event_id: String(evidence.event_id || evidence.eventId || `auto-${stableId({ taskId, id, version, kind, source })}`),
      record_id: id, record_version: version, task_id: taskId, kind, source,
      observed_at: evidence.observed_at || evidence.observedAt,
    };
    if (!event.observed_at) delete event.observed_at;
    if (legacy && kind === 'applied_success') this.legacyPositiveEvidence.add(id);
    else this.structuredEvidence.set(event.event_id, event);
    return true;
  }

  qualify(candidate) {
    return isObject(candidate) && typeof candidate.type === 'string' && typeof candidate.content === 'string'
      && candidate.content.trim() && candidate.verified === true && candidate.isNew === true
      && candidate.conflictFree === true;
  }

  /** End task and run only policy-allowed automatic hooks. */
  async endTask(input = {}) {
    if (!this.started || this.ended) throw new Error('MemorySession 当前不在可结束状态');
    if (!isObject(input)) throw new TypeError('endTask 输入必须是对象');
    const added = [];
    // Automatic saves are host-owned: never promote an Agent return value into
    // a durable candidate unless the host explicitly passes it to endTask.
    const candidates = Array.isArray(input.candidates) ? input.candidates
      : (Array.isArray(input.conclusions) ? input.conclusions : []);
    // Only evidence explicitly supplied by the host may affect the ledger.
    // Agent self-reported evidence is intentionally ignored for auto-rating.
    const evidence = Array.isArray(input.evidence) ? input.evidence : [];
    for (const item of evidence) this.recordEvidence(item, { hostProvided: true });
    this.ended = true;
    if (!this.policy.auto_save) {
      this.emit('save', false, this.policy.failClosed ? 'fail-closed' : 'policy-disabled');
    } else {
      let saveFailures = 0;
      for (const candidate of candidates) {
        if (!this.qualify(candidate)) continue;
        try {
          const result = this.runCli({ node: this.node, cliPath: this.cliPath, projectRoot: this.projectRoot,
            args: ['add', '--type', candidate.type, ...(candidate.group ? ['--group', candidate.group] : [])], input: candidate.content.trim() });
          const id = result.stdout.trim().split(/\s+/).pop();
          if (/^\d+$/.test(id)) added.push(id);
        } catch {
          saveFailures++;
          this.emit('save', false, 'store-write-failure');
        }
      }
      this.emit('save', saveFailures === 0, saveFailures ? 'partial-failure' : 'policy-enabled', { count: added.length, outcome: saveFailures ? 'partial' : 'allowed' });
    }
    const rated = [];
    if (!this.policy.auto_rate) {
      this.emit('rate', false, this.policy.failClosed ? 'fail-closed' : 'policy-disabled');
    } else {
      let rateFailures = 0;
      for (const event of this.structuredEvidence.values()) {
        try {
          const result = this.runCli({ node: this.node, cliPath: this.cliPath, projectRoot: this.projectRoot,
            args: ['evidence', 'append', '--event-json', JSON.stringify(event)] });
          const parsed = JSON.parse(result.stdout || '{}');
          if (parsed.applied || parsed.duplicate) rated.push(event.event_id);
        } catch {
          rateFailures++;
          this.emit('rate', false, 'store-score-failure', { event_id: event.event_id });
        }
      }
      // Compatibility for callers that still submit { positive: true }.
      for (const id of this.legacyPositiveEvidence) {
        if (this.ratedRecords.has(id)) continue;
        try {
          this.runCli({ node: this.node, cliPath: this.cliPath, projectRoot: this.projectRoot, args: ['score', id, '+1'] });
          this.ratedRecords.add(id); rated.push(id);
        } catch { rateFailures++; this.emit('rate', false, 'store-score-failure', { refid: id }); }
      }
      this.emit('rate', rateFailures === 0, rateFailures ? 'partial-failure' : 'policy-enabled', { count: rated.length, outcome: rateFailures ? 'partial' : 'allowed' });
    }
    return Object.freeze({ added, rated, audit: this.auditEvents.slice() });
  }

  /** Direct Agent access is unavailable; host must not grant shell/fs or raw CLI tools. */
  requestMemoryTool() {
    throw new Error('MemorySession 拒绝 Agent 直接访问 memory store/CLI；请使用生命周期 API');
  }

  async invokeTool() {
    throw new Error('MemorySession 拒绝 Agent 直接访问 memory store/CLI；请使用生命周期 API');
  }
}

export default MemorySession;
