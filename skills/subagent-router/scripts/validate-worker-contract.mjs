#!/usr/bin/env node
import fs from 'node:fs';

const usage = 'Usage: node validate-worker-contract.mjs --kind <input|result> [--type <research|review|write|batch>] [--input <file|->] <file|->';
const fail = (messages) => { for (const message of messages) console.error('validate-worker-contract: ' + message); process.exit(2); };
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) { console.log(usage); process.exit(0); }
const value = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const kind = value('--kind');
const type = value('--type');
const optionFile = value('--input');
const knownValueFlags = new Set(['--kind', '--type', '--input']);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg.startsWith('--') && !knownValueFlags.has(arg)) fail(['unknown option: ' + arg]);
  if (knownValueFlags.has(arg) && (!args[index + 1] || args[index + 1].startsWith('--'))) fail([arg + ' requires a value']);
}
const positional = args.filter((arg, index) => index === 0 || !knownValueFlags.has(args[index - 1])).filter((arg) => !arg.startsWith('--'));
const file = optionFile || positional.at(-1);
if (!['input', 'result'].includes(kind) || !file || (optionFile && positional.length > 0)) { console.log(usage); process.exit(2); }
if (type && !['research', 'review', 'write', 'batch'].includes(type)) fail(['--type must be research, review, write, or batch']);
let data;
try { data = JSON.parse(file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8')); } catch (error) { fail(['invalid JSON input: ' + error.message]); }
if (!data || Array.isArray(data) || typeof data !== 'object') fail(['document must be a JSON object']);

const errors = [];
const models = ['luna', 'terra', 'sol'];
const requireFields = (fields) => fields.forEach((field) => { if (!(field in data)) errors.push('missing required field: ' + field); });
const enumField = (field, options) => { if (field in data && !options.includes(data[field])) errors.push(field + ' must be one of: ' + options.join(', ')); };
const arrayField = (field) => { if (!Array.isArray(data[field])) errors.push(field + ' must be an array'); };
const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const delegationField = () => {
  const delegation = data.delegation;
  if (!delegation || Array.isArray(delegation) || typeof delegation !== 'object') { errors.push('delegation must be an object'); return; }
  if (typeof delegation.enabled !== 'boolean') errors.push('delegation.enabled must be boolean');
  if (!Array.isArray(delegation.allowed_child_models) || !delegation.allowed_child_models.every((model) => models.includes(model))) errors.push('delegation.allowed_child_models must contain only luna, terra, or sol');
  for (const field of ['max_depth', 'max_workers', 'max_concurrency']) if (!nonNegativeInteger(delegation[field])) errors.push('delegation.' + field + ' must be a non-negative integer');
  if (data.model === 'luna' && (delegation.enabled || delegation.allowed_child_models?.length)) errors.push('a Luna Worker cannot delegate and must have an empty allowed_child_models list');
  if (nonNegativeInteger(data.spawn_depth) && nonNegativeInteger(delegation.max_depth) && data.spawn_depth > delegation.max_depth) errors.push('spawn_depth cannot exceed delegation.max_depth');
};

if (kind === 'input') {
  requireFields(['task_id', 'goal', 'parent_model', 'model', 'reasoning_effort', 'spawn_depth', 'permission', 'context_level', 'workspace', 'allowed_scope', 'forbidden_actions', 'known_facts', 'delegation', 'output_contract', 'acceptance_criteria', 'failure_contract']);
  enumField('parent_model', models); enumField('model', models); enumField('permission', ['read', 'write']); enumField('context_level', ['minimal', 'summarized', 'expanded']); enumField('output_contract', ['research', 'review', 'write', 'batch']);
  if (data.parent_model === 'luna') errors.push('a Luna parent cannot create a Worker');
  if (!nonNegativeInteger(data.spawn_depth)) errors.push('spawn_depth must be a non-negative integer');
  ['allowed_scope', 'forbidden_actions', 'known_facts', 'acceptance_criteria'].forEach(arrayField);
  delegationField();
} else {
  requireFields(['status', 'task_id', 'parent_model', 'model', 'reasoning_effort', 'spawn_depth', 'permission', 'context_level', 'workspace', 'scope_observed', 'summary', 'evidence', 'validation', 'boundary_violations', 'unresolved']);
  enumField('status', ['completed', 'partial', 'blocked', 'failed']); enumField('parent_model', [...models, 'unverified']); enumField('model', [...models, 'unverified']); enumField('permission', ['read', 'write', 'unverified']); enumField('context_level', ['minimal', 'summarized', 'expanded', 'unverified']);
  if (!nonNegativeInteger(data.spawn_depth) && data.spawn_depth !== 'unverified') errors.push('spawn_depth must be a non-negative integer or unverified');
  ['scope_observed', 'evidence', 'validation', 'boundary_violations', 'unresolved'].forEach(arrayField);
  if (data.status === 'completed') {
    if (Array.isArray(data.evidence) && data.evidence.length === 0) errors.push('completed result requires non-empty evidence');
    if (Array.isArray(data.validation) && data.validation.length === 0) errors.push('completed result requires non-empty validation');
    if (Array.isArray(data.boundary_violations) && data.boundary_violations.length > 0) errors.push('completed result cannot contain boundary_violations');
    if (Array.isArray(data.unresolved) && data.unresolved.length > 0) errors.push('completed result cannot contain unresolved items');
  }
  const actualType = type || data.output_contract;
  if (!actualType) errors.push('result requires --type or output_contract');
  if (actualType === 'research') { requireFields(['findings', 'confidence', 'unknowns']); arrayField('findings'); arrayField('unknowns'); enumField('confidence', ['high', 'medium', 'low']); }
  if (actualType === 'review') {
    requireFields(['issues']); arrayField('issues');
    (data.issues || []).forEach((issue, index) => {
      ['severity', 'location', 'rationale', 'recommendation'].forEach((field) => { if (!issue || !(field in issue)) errors.push('issues[' + index + '] missing ' + field); });
      if (issue?.severity && !['critical', 'high', 'medium', 'low', 'note'].includes(issue.severity)) errors.push('issues[' + index + '].severity is invalid');
    });
  }
  if (actualType === 'write') { requireFields(['changed_files', 'diff_summary', 'validation_commands', 'validation_results', 'rollback_reference']); ['changed_files', 'diff_summary', 'validation_commands', 'validation_results'].forEach(arrayField); }
  if (actualType === 'batch') {
    requireFields(['item_results', 'failed_items', 'summary_statistics']); arrayField('item_results'); arrayField('failed_items');
    if (!data.summary_statistics || Array.isArray(data.summary_statistics) || typeof data.summary_statistics !== 'object') errors.push('summary_statistics must be an object');
    (data.item_results || []).forEach((item, index) => {
      if (!item || Array.isArray(item) || typeof item !== 'object') errors.push('item_results[' + index + '] must be an object with status');
      else if (!['completed', 'partial', 'blocked', 'failed'].includes(item.status)) errors.push('item_results[' + index + '].status must be completed, partial, blocked, or failed');
    });
  }
}
if (errors.length) fail(errors);
console.log('validate-worker-contract: valid ' + kind + (type ? ' (' + type + ')' : ''));
