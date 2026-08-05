#!/usr/bin/env node
import fs from 'node:fs';

const usage = 'Usage: node validate-worker-contract.mjs --kind <input|result> [--type <research|review|write|batch>] <file.json|->';
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) { console.log(usage); process.exit(0); }
const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const kind = value('--kind'); const type = value('--type'); const file = args.filter((arg, i) => !['--kind', '--type'].includes(args[i - 1]) && !arg.startsWith('--')).at(-1);
const fail = (messages) => { for (const m of messages) console.error(`validate-worker-contract: ${m}`); process.exit(2); };
if (!['input', 'result'].includes(kind) || !file) { console.log(usage); process.exit(2); }
if (type && !['research', 'review', 'write', 'batch'].includes(type)) fail(['--type must be research, review, write, or batch']);
let data; try { data = JSON.parse(file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8')); } catch (e) { fail([`invalid JSON input: ${e.message}`]); }
if (!data || Array.isArray(data) || typeof data !== 'object') fail(['document must be a JSON object']);
const errors = [];
const requireFields = (fields) => fields.forEach((field) => { if (!(field in data) || data[field] === '' || data[field] == null) errors.push(`missing required field: ${field}`); });
const enumField = (field, options) => { if (field in data && !options.includes(data[field])) errors.push(`${field} must be one of: ${options.join(', ')}`); };
const arrayField = (field) => { if (!Array.isArray(data[field])) errors.push(`${field} must be an array`); };
if (kind === 'input') {
  requireFields(['task_id', 'goal', 'backend', 'model', 'provider_profile', 'reasoning_effort', 'context_level', 'workspace', 'allowed_scope', 'forbidden_actions', 'known_facts', 'output_contract', 'acceptance_criteria', 'failure_contract']);
  enumField('backend', ['native_spawn', 'external_exec']); enumField('context_level', ['minimal', 'summarized', 'expanded']); enumField('output_contract', ['research', 'review', 'write', 'batch']);
  ['allowed_scope', 'forbidden_actions', 'known_facts', 'acceptance_criteria'].forEach(arrayField);
} else {
  requireFields(['status', 'task_id', 'backend', 'model', 'provider_profile', 'reasoning_effort', 'context_level', 'workspace', 'scope_observed', 'summary', 'evidence', 'validation', 'boundary_violations', 'unresolved']);
  enumField('status', ['completed', 'partial', 'blocked', 'failed']); enumField('backend', ['native_spawn', 'external_exec']); enumField('context_level', ['minimal', 'summarized', 'expanded']);
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
  if (actualType === 'review') { requireFields(['issues']); arrayField('issues'); (data.issues || []).forEach((issue, i) => { ['severity', 'location', 'rationale', 'recommendation'].forEach((f) => { if (!issue || !(f in issue)) errors.push(`issues[${i}] missing ${f}`); }); if (issue?.severity && !['critical', 'high', 'medium', 'low', 'note'].includes(issue.severity)) errors.push(`issues[${i}].severity is invalid`); }); }
  if (actualType === 'write') { requireFields(['changed_files', 'diff_summary', 'validation_commands', 'validation_results', 'rollback_reference']); ['changed_files', 'diff_summary', 'validation_commands', 'validation_results'].forEach(arrayField); }
  if (actualType === 'batch') {
    requireFields(['item_results', 'failed_items', 'summary_statistics']); arrayField('item_results'); arrayField('failed_items');
    if (!data.summary_statistics || Array.isArray(data.summary_statistics) || typeof data.summary_statistics !== 'object') errors.push('summary_statistics must be an object');
    (data.item_results || []).forEach((item, index) => {
      if (!item || Array.isArray(item) || typeof item !== 'object') errors.push(`item_results[${index}] must be an object with status`);
      else if (!['completed', 'partial', 'blocked', 'failed'].includes(item.status)) errors.push(`item_results[${index}].status must be completed, partial, blocked, or failed`);
    });
  }
}
if (errors.length) fail(errors);
console.log(`validate-worker-contract: valid ${kind}${type ? ` (${type})` : ''}`);
