#!/usr/bin/env node
import fs from 'node:fs';

const usage = 'Usage: node route-decision.mjs [--input <input.json|->] [<input.json|->]\nBoth --input and the legacy positional input are supported; provide exactly one.\nRequired: capability, permission, execution_authorized. Optional: external_plan_disclosed, top_level_available, isolated_workspace.';
const fail = (message) => { console.error(`route-decision: ${message}`); console.error(usage); process.exit(2); };
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) { console.log(usage); process.exit(0); }
let optionFile;
const positional = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--input') {
    optionFile = args[++index];
    if (!optionFile || optionFile.startsWith('--')) fail('--input requires <input.json|->');
  } else if (arg.startsWith('--')) {
    fail(`unknown option: ${arg}`);
  } else {
    positional.push(arg);
  }
}
if (positional.length > 1 || (optionFile && positional.length)) fail('provide exactly one input using --input <file|-> or the legacy positional form');
const file = optionFile || positional[0];
if (!file) fail('missing input; use --input <file|-> or the legacy positional form');
let input;
try { input = JSON.parse(file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8')); } catch (error) { fail(`invalid JSON input: ${error.message}`); }
const capabilities = new Set(['native_supported', 'native_unsupported', 'unknown', 'temporarily_unavailable']);
const permissions = new Set(['read', 'write']);
if (!capabilities.has(input.capability)) fail('capability must be native_supported, native_unsupported, unknown, or temporarily_unavailable');
if (!permissions.has(input.permission)) fail('permission must be read or write');
if (typeof input.execution_authorized !== 'boolean') fail('execution_authorized must be boolean');
const blocked = (reason, authorizationRequired = false) => ({ backend: 'blocked', executable: false, reason, authorization_required: authorizationRequired });
let output;
if (!input.execution_authorized) {
  output = blocked('exact authorization phrase 授权执行 is required before execution', true);
} else if (input.capability === 'native_supported') {
  output = { backend: 'native_spawn', executable: true, reason: 'native support is confirmed; native execution is mandatory', authorization_required: false };
} else if (input.capability === 'unknown') {
  output = blocked('native capability is unknown; perform low-cost read-only verification before any external fallback');
} else if (input.capability === 'temporarily_unavailable') {
  output = blocked('native capability is temporarily unavailable; treat as a technical failure and retry once unchanged');
} else if (!input.top_level_available) {
  output = blocked('external fallback requires verified top-level model or provider/profile availability');
} else if (!input.external_plan_disclosed) {
  output = blocked('external fallback was not disclosed in the authorized execution plan', true);
} else if (input.permission === 'write' && !input.isolated_workspace) {
  output = blocked('external write requires an isolated worktree or authorized temporary copy', true);
} else {
  output = { backend: 'external_exec', executable: true, reason: 'native support is unavailable and controlled fallback conditions are met', authorization_required: false };
}
console.log(JSON.stringify({ requested_capability: input.capability, permission: input.permission, ...output }, null, 2));
