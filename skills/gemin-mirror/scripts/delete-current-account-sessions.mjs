#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  normalizeAccountId,
  parseJsonOutput,
  redactAccountId,
  selectVerifiedAccount,
  validateExecutionOptions,
} from './session-safety.mjs';

const argv = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (!token.startsWith('--')) continue;
  const key = token.slice(2);
  const next = process.argv[i + 1];
  argv.set(key, next && !next.startsWith('--') ? next : true);
  if (next && !next.startsWith('--')) i += 1;
}

const origin = String(argv.get('origin') || process.env.GEMINI_MIRROR_ORIGIN || 'https://gemini-d-google-d-com-s-gmn.tuangouai.com/app');
const cdp = String(argv.get('cdp') || process.env.CDP_PORT || 9696);
const session = String(argv.get('session') || process.env.AGENT_BROWSER_SESSION || process.cwd().replace(/[^a-zA-Z0-9._-]/g, '') || 'gemin-mirror');
const chatSelector = String(argv.get('chat-selector') || process.env.GEMINI_MIRROR_CHAT_SELECTOR || '#sidenav-section-content-chats gem-nav-list-item');
const activeSelector = String(argv.get('active-account-selector') || process.env.GEMINI_MIRROR_ACTIVE_ACCOUNT_SELECTOR || '[data-active="true"],[aria-current="true"],[data-expanded="1"]');
const loginFailureText = String(argv.get('login-failure-text') || process.env.GEMINI_MIRROR_LOGIN_FAILURE_TEXT || '登录已失效');
const deleteText = String(argv.get('delete-text') || process.env.GEMINI_MIRROR_DELETE_TEXT || '删除');
const maxItems = Number(argv.get('max-items') || 200);
const maxRetries = Number(argv.get('max-retries') || 3);
const waitMs = Number(argv.get('wait-ms') || 800);
const auditPath = String(argv.get('audit') || `${process.env.TEMP || process.env.TMP || '/tmp'}/gemin-mirror-session-audit.jsonl`);
const dryRun = argv.has('dry-run');
const confirmDelete = argv.has('confirm-delete');
const expectedAccount = normalizeAccountId(argv.get('expected-account'));
validateExecutionOptions({ dryRun, confirmDelete, expectedAccount });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fail(message) { throw new Error(message); }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || result.stdout?.trim() || `runner exited ${result.status}`);
  return (result.stdout || '').trim();
}

function resolveRunner() {
  if (process.platform === 'win32') {
    try {
      const listing = run('w', ['-l'], { shell: true });
      if (/\babc\b/i.test(listing)) return { kind: 'w-abc', label: 'w abc' };
    } catch { /* use native */ }
    return { kind: 'native', label: 'agent-browser' };
  }
  if (process.platform === 'linux' || process.platform === 'darwin') {
    try {
      const probe = run('/bin/bash', ['-lc', 'if [ -f "$HOME/.bashrc" ]; then source "$HOME/.bashrc"; fi; command -v abc']);
      if (probe) return { kind: 'abc', label: 'abc' };
    } catch { /* use native */ }
  }
  return { kind: 'native', label: 'agent-browser' };
}

let runner = resolveRunner();
let fallbackReason = null;
function invokeBatch(commands, selected = runner) {
  const base = ['--cdp', cdp, '--session', session, 'batch'];
  const input = JSON.stringify(commands);
  if (selected.kind === 'w-abc') return run('w', ['abc', ...base], { shell: true, input });
  if (selected.kind === 'abc') {
    return run('/bin/bash', ['-lc', `if [ -f "$HOME/.bashrc" ]; then source "$HOME/.bashrc"; fi; abc ${base.map((x) => `'${String(x).replaceAll("'", `'\\''`)}'`).join(' ')}`], { input });
  }
  return run('agent-browser', base, { shell: process.platform === 'win32', input });
}
function runBrowser(command) {
  try { return invokeBatch([command]); }
  catch (error) {
    if (runner.kind === 'native') throw error;
    fallbackReason = `${runner.label}: ${error.message}`;
    runner = { kind: 'native', label: 'agent-browser' };
    return invokeBatch([command], runner);
  }
}
function evalBrowser(expression) {
  return parseJsonOutput(runBrowser(['eval', expression]));
}
function audit(accountRef, entry) {
  appendFileSync(auditPath, `${JSON.stringify({ timestamp: new Date().toISOString(), runner: runner.label, fallbackReason, accountRef, ...entry })}\n`, 'utf8');
}
async function clickCenter(point) {
  runBrowser(['mouse', 'move', String(Math.round(point.x)), String(Math.round(point.y))]);
  runBrowser(['mouse', 'down']);
  runBrowser(['mouse', 'up']);
}
function visiblePoint(expression, missingMessage) {
  const point = evalBrowser(expression);
  if (!point) fail(missingMessage);
  return point;
}

const q = (value) => JSON.stringify(String(value));
const state = evalBrowser(`(()=>{const active=[...document.querySelectorAll(${q(activeSelector)})].map(e=>{const id=e.querySelector('.account-id')?.textContent?.trim();if(id)return id;const label=e.getAttribute('aria-label')||'';const email=label.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)?.[0];if(email)return email;return (e.textContent||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)?.[0]||''}).filter(Boolean);return {url:location.href,title:document.title,loggedIn:!document.body.innerText.includes(${q(loginFailureText)}),count:document.querySelectorAll(${q(chatSelector)}).length,accountCandidates:active}})()`);
if (!state.loggedIn) fail('登录状态失效，已停止。');
if (!String(state.url).startsWith(origin)) fail(`目标页面不匹配：${state.url}`);
const verifiedAccount = selectVerifiedAccount(state.accountCandidates, expectedAccount);
const accountRef = redactAccountId(verifiedAccount);

let completed = 0;
for (; completed < maxItems; completed += 1) {
  const before = Number(evalBrowser(`document.querySelectorAll(${q(chatSelector)}).length`));
  if (before === 0) break;
  let success = false;
  for (let retry = 0; retry < maxRetries && !success; retry += 1) {
    try {
      runBrowser(['scrollintoview', `${chatSelector}:first-child`]);
      runBrowser(['hover', `${chatSelector}:first-child a > span`]);
      const more = visiblePoint(`(()=>{const b=document.querySelector(${q(`${chatSelector}:first-child button`)});if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`, '更多按钮不可见');
      await clickCenter(more); await sleep(350);
      const menu = visiblePoint(`(()=>{const e=[...document.querySelectorAll('[role=menuitem]')].find(x=>x.innerText.trim()===${q(deleteText)}&&x.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`, '删除菜单项不可见');
      await clickCenter(menu); await sleep(350);
      const confirm = visiblePoint(`(()=>{const e=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()===${q(deleteText)}&&x.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`, '确认删除按钮不可见');
      if (!dryRun) await clickCenter(confirm);
      await sleep(waitMs);
      const after = Number(evalBrowser(`document.querySelectorAll(${q(chatSelector)}).length`));
      audit(accountRef, { action: dryRun ? 'dry-run-delete-session' : 'delete-session', before, after, retry, url: state.url });
      if (dryRun) { success = true; break; }
      if (after >= before) fail(`删除后计数未下降：${before} -> ${after}`);
      success = true;
    } catch (error) {
      if (retry === maxRetries - 1) { audit(accountRef, { action: 'error', before, retry, error: error.message, url: state.url }); throw error; }
      await sleep(500);
    }
  }
  if (dryRun) break;
}
const remaining = Number(evalBrowser(`document.querySelectorAll(${q(chatSelector)}).length`));
audit(accountRef, { action: 'complete', remaining, dryRun });
console.log(`runner=${runner.label}; account=${accountRef}; completed=${completed}; remaining=${remaining}; audit=${auditPath}`);
