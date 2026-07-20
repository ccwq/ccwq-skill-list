#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  normalizeAccountId,
  redactAccountId,
  selectVerifiedAccount,
  validateExecutionOptions,
} from './session-safety.mjs';

const TARGET_ORIGIN = 'https://gemini-d-google-d-com-s-gmn.tuangouai.com/app';
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (!token.startsWith('--')) continue;
  const key = token.slice(2);
  const next = process.argv[i + 1];
  args.set(key, next && !next.startsWith('--') ? next : true);
  if (next && !next.startsWith('--')) i += 1;
}

const cdp = String(args.get('cdp') || 9696);
const defaultSession = process.cwd().replace(/[^a-zA-Z0-9._-]/g, '') || 'gemin-mirror';
const session = String(args.get('session') || defaultSession);
const maxItems = Number(args.get('max-items') || 200);
const maxRetries = Number(args.get('max-retries') || 3);
const waitMs = Number(args.get('wait-ms') || 800);
const auditPath = String(args.get('audit') || `${process.env.TEMP || process.env.TMP || '/tmp'}/gemin-mirror-session-audit.jsonl`);
const dryRun = args.has('dry-run');
const confirmDelete = args.has('confirm-delete');
const expectedAccount = normalizeAccountId(args.get('expected-account'));
const isWindows = process.platform === 'win32';
const isUnix = process.platform === 'linux' || process.platform === 'darwin';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

validateExecutionOptions({ dryRun, confirmDelete, expectedAccount });

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || result.stdout?.trim() || `agent-browser exited ${result.status}`);
  return (result.stdout || '').trim();
}

function resolveRunner() {
  if (isWindows) {
    try {
      const listing = run('w', ['-l'], { shell: true });
      if (/\babc\b/i.test(listing)) return { kind: 'w-abc', label: 'w abc' };
    } catch { /* fall through to native CLI */ }
    return { kind: 'native', label: 'agent-browser' };
  }
  if (isUnix) {
    try {
      const probe = run('/bin/bash', ['-lc', 'if [ -f "$HOME/.bashrc" ]; then source "$HOME/.bashrc"; fi; command -v abc']);
      if (probe) return { kind: 'abc', label: 'abc' };
    } catch { /* fall through to native CLI */ }
  }
  return { kind: 'native', label: 'agent-browser' };
}

let runner = resolveRunner();
let fallbackReason = null;

function runWithRunner(commandArgs, selectedRunner) {
  const browserArgs = ['--cdp', cdp, '--session', session, ...commandArgs];
  if (selectedRunner.kind === 'w-abc') return run('w', ['abc', ...browserArgs], { shell: true });
  if (selectedRunner.kind === 'abc') {
    const command = `if [ -f "$HOME/.bashrc" ]; then source "$HOME/.bashrc"; fi; abc ${browserArgs.map(shellQuote).join(' ')}`;
    return run('/bin/bash', ['-lc', command]);
  }
  return run('agent-browser', browserArgs, { shell: isWindows });
}

function runBrowser(commandArgs) {
  try { return runWithRunner(commandArgs, runner); }
  catch (error) {
    if (runner.kind === 'native') throw error;
    fallbackReason = `${runner.label}: ${error.message}`;
    runner = { kind: 'native', label: 'agent-browser' };
    return runWithRunner(commandArgs, runner);
  }
}

function evalBrowser(expression) {
  const output = runBrowser(['eval', expression]);
  try { return JSON.parse(output); } catch { /* pretty output or diagnostic prefix */ }
  const raw = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) || '';
  try { return JSON.parse(raw); } catch { return raw; }
}

function audit(entry) {
  appendFileSync(auditPath, `${JSON.stringify({ timestamp: new Date().toISOString(), runner: runner.label, fallbackReason, accountRef, ...entry })}\n`, 'utf8');
}

async function clickCenter(point) {
  runBrowser(['mouse', 'move', String(Math.round(point.x)), String(Math.round(point.y))]);
  runBrowser(['mouse', 'down']);
  runBrowser(['mouse', 'up']);
}

const state = evalBrowser(`(()=>({
  url:location.href,
  title:document.title,
  loggedIn:!document.body.innerText.includes('登录已失效'),
  count:document.querySelectorAll('#sidenav-section-content-chats gem-nav-list-item').length,
  accountCandidates:[...document.querySelectorAll('#_my_chat_list_container .-my-chat-account[data-expanded="1"] .account-id')].map((element)=>element.textContent.trim())
}))()`);
if (!state.loggedIn) throw new Error('登录状态失效，已停止。');
if (!String(state.url).startsWith(TARGET_ORIGIN)) throw new Error(`目标页面不匹配：${state.url}`);
const verifiedAccount = selectVerifiedAccount(state.accountCandidates, expectedAccount);
const accountRef = redactAccountId(verifiedAccount);

let completed = 0;
for (; completed < maxItems; completed += 1) {
  const before = Number(evalBrowser(`document.querySelectorAll('#sidenav-section-content-chats gem-nav-list-item').length`));
  if (before === 0) break;
  let success = false;
  for (let retry = 0; retry < maxRetries && !success; retry += 1) {
    try {
      runBrowser(['scrollintoview', '#sidenav-section-content-chats gem-nav-list-item:nth-child(1)']);
      runBrowser(['hover', '#sidenav-section-content-chats gem-nav-list-item:nth-child(1) a > span']);
      const more = evalBrowser(`(()=>{const b=document.querySelector('#sidenav-section-content-chats gem-nav-list-item:nth-child(1) button');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      if (!more) throw new Error('更多按钮不可见');
      await clickCenter(more); await sleep(350);
      const menu = evalBrowser(`(()=>{const e=[...document.querySelectorAll('[role=menuitem]')].find(x=>x.innerText.trim()==='删除'&&x.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      if (!menu) throw new Error('删除菜单项不可见');
      await clickCenter(menu); await sleep(350);
      const confirm = evalBrowser(`(()=>{const e=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='删除'&&x.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      if (!confirm) throw new Error('确认删除按钮不可见');
      if (!dryRun) await clickCenter(confirm);
      await sleep(waitMs);
      const after = Number(evalBrowser(`document.querySelectorAll('#sidenav-section-content-chats gem-nav-list-item').length`));
      audit({ action: dryRun ? 'dry-run-delete-session' : 'delete-session', before, after, retry, url: state.url });
      if (dryRun) { success = true; break; }
      if (after >= before) throw new Error(`删除后计数未下降：${before} -> ${after}`);
      success = true;
    } catch (error) {
      if (retry === maxRetries - 1) { audit({ action: 'error', before, retry, error: error.message, url: state.url }); throw error; }
      await sleep(500);
    }
  }
  if (dryRun) break;
}

const remaining = Number(evalBrowser(`document.querySelectorAll('#sidenav-section-content-chats gem-nav-list-item').length`));
audit({ action: 'complete', remaining, dryRun });
console.log(`runner=${runner.label}; completed; remaining=${remaining}; audit=${auditPath}`);
