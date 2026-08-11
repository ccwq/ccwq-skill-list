#!/usr/bin/env node
import fs from 'node:fs';

const usage = 'Usage: node route-decision.mjs [--input <input.json|->] [<input.json|->]\nBoth --input and the legacy positional input are supported; provide exactly one.\nRequired: parent_model, requested_model, authorization_message, current_depth, workers_created, active_workers, delegation.';
const fail = (message) => { console.error('route-decision: ' + message); console.error(usage); process.exit(2); };
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) { console.log(usage); process.exit(0); }
let optionFile;
const positional = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--input') {
    optionFile = args[++index];
    if (!optionFile || optionFile.startsWith('--')) fail('--input requires <input.json|->');
  } else if (arg.startsWith('--')) fail('unknown option: ' + arg);
  else positional.push(arg);
}
if (positional.length > 1 || (optionFile && positional.length)) fail('provide exactly one input using --input <file|-> or the legacy positional form');
const file = optionFile || positional[0];
if (!file) fail('missing input; use --input <file|-> or the legacy positional form');
let input;
try { input = JSON.parse(file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8')); } catch (error) { fail('invalid JSON input: ' + error.message); }

const models = new Set(['luna', 'terra', 'sol']);
const integer = (value) => Number.isInteger(value) && value >= 0;
if (!models.has(input.parent_model)) fail('parent_model must be luna, terra, or sol');
if (!models.has(input.requested_model)) fail('requested_model must be luna, terra, or sol');
if (typeof input.authorization_message !== 'string') fail('authorization_message must be a string');
if (!integer(input.current_depth)) fail('current_depth must be a non-negative integer');
if (!integer(input.workers_created)) fail('workers_created must be a non-negative integer');
if (!integer(input.active_workers)) fail('active_workers must be a non-negative integer');
const envelope = input.delegation;
if (!envelope || Array.isArray(envelope) || typeof envelope !== 'object') fail('delegation must be an object');
if (typeof envelope.enabled !== 'boolean') fail('delegation.enabled must be boolean');
if (!Array.isArray(envelope.allowed_child_models) || !envelope.allowed_child_models.every((model) => models.has(model))) fail('delegation.allowed_child_models must contain only luna, terra, or sol');
for (const field of ['max_depth', 'max_workers', 'max_concurrency']) if (!integer(envelope[field])) fail('delegation.' + field + ' must be a non-negative integer');

const blocked = (reason, authorizationRequired = false) => ({
  backend: 'native_spawn',
  executable: false,
  reason,
  authorization_required: authorizationRequired,
});
let output;
if (input.authorization_message.trim() !== 'okok') {
  output = blocked('a standalone exact okok authorization is required before execution', true);
} else if (input.parent_model === 'luna') {
  output = blocked('Luna cannot create child Workers; use direct main-thread work or rerun from Terra or Sol');
} else if (!envelope.enabled) {
  output = blocked('the current delegation envelope does not allow child Workers', true);
} else if (!envelope.allowed_child_models.includes(input.requested_model)) {
  output = blocked('requested child model is outside the current delegation envelope', true);
} else if (input.current_depth >= envelope.max_depth) {
  output = blocked('requested child would exceed the current maximum delegation depth', true);
} else if (input.workers_created >= envelope.max_workers) {
  output = blocked('requested child would exceed the current maximum Worker count', true);
} else if (envelope.max_concurrency === 0) {
  output = blocked('the current delegation envelope has no available concurrency', true);
} else if (input.active_workers >= envelope.max_concurrency) {
  output = blocked('requested child would exceed the current maximum Worker concurrency', true);
} else {
  output = {
    backend: 'native_spawn',
    executable: true,
    reason: 'native model nesting is authorized inside the current delegation envelope',
    authorization_required: false,
  };
}
console.log(JSON.stringify({
  parent_model: input.parent_model,
  requested_model: input.requested_model,
  child_depth: input.current_depth + 1,
  active_workers: input.active_workers,
  max_concurrency: envelope.max_concurrency,
  ...output,
}, null, 2));
