#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  boundedJitter,
  isRetryableApiStatus,
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
const activeSelector = String(argv.get('active-account-selector') || process.env.GEMINI_MIRROR_ACTIVE_ACCOUNT_SELECTOR || '.mavatar-footer-left');
const loginFailureText = String(argv.get('login-failure-text') || process.env.GEMINI_MIRROR_LOGIN_FAILURE_TEXT || '登录已失效');
const concurrency = Math.max(1, Number(argv.get('concurrency') || 4));
const maxRetries = Math.max(0, Number(argv.get('max-retries') || 3));
const jitterMinMs = Math.max(0, Number(argv.get('jitter-min-ms') || 150));
const jitterMaxMs = Math.max(jitterMinMs, Number(argv.get('jitter-max-ms') || 450));
const waitMs = Math.max(0, Number(argv.get('wait-ms') || 1200));
const atGlobalPath = String(argv.get('at-global-path') || process.env.GEMINI_MIRROR_AT_GLOBAL_PATH || 'WIZ_global_data.SNlM0e');
const auditPath = String(argv.get('audit') || `${process.env.TEMP || process.env.TMP || '/tmp'}/gemin-mirror-session-audit.jsonl`);
const dryRun = argv.has('dry-run');
const confirmDelete = argv.has('confirm-delete');
const expectedAccount = normalizeAccountId(argv.get('expected-account'));
validateExecutionOptions({ dryRun, confirmDelete, expectedAccount });

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
    } catch { /* native fallback */ }
  }
  return { kind: 'native', label: 'agent-browser' };
}
let runner = resolveRunner();
function invokeBatch(commands, selected = runner) {
  const base = ['--cdp', cdp, '--session', session, 'batch'];
  const input = JSON.stringify(commands);
  if (selected.kind === 'w-abc') return run('w', ['abc', ...base], { shell: true, input });
  return run('agent-browser', base, { shell: process.platform === 'win32', input });
}
function runBrowser(command) {
  try { return invokeBatch([command]); }
  catch (error) {
    if (runner.kind === 'native') throw error;
    runner = { kind: 'native', label: 'agent-browser' };
    return invokeBatch([command], runner);
  }
}
function evalBrowser(expression) { return parseJsonOutput(runBrowser(['eval', expression])); }
function audit(accountRef, entry) {
  appendFileSync(auditPath, `${JSON.stringify({ timestamp: new Date().toISOString(), runner: runner.label, accountRef, ...entry })}\n`, 'utf8');
}

// agent-browser 的 eval 参数在 Windows shell 下对嵌入式双引号不稳定；
// 使用经过转义的单引号 JS 字符串，避免 selector/URL 生成不可解析表达式。
const q = (value) => `'${String(value)
  .replaceAll('\\', '\\\\')
  .replaceAll("'", "\\'")
  .replaceAll('\r', '\\r')
  .replaceAll('\n', '\\n')}'`;
const state = evalBrowser(`(()=>{const active=[...document.querySelectorAll(${q(activeSelector)})].map(e=>{const label=e.getAttribute('aria-label')||'';return label.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)?.[0]||(e.textContent||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)?.[0]||''}).filter(Boolean);return {url:location.href,loggedIn:!document.body.innerText.includes(${q(loginFailureText)}),count:document.querySelectorAll(${q(chatSelector)}).length,accountCandidates:active}})()`);
if (!state.loggedIn) fail('登录状态失效，已停止。');
if (!String(state.url).startsWith(origin)) fail(`目标页面不匹配：${state.url}`);
const verifiedAccount = selectVerifiedAccount(state.accountCandidates, expectedAccount);
const accountRef = redactAccountId(verifiedAccount);
const before = Number(state.count);
if (before === 0) { audit(accountRef, { action: 'complete', mode: 'api', before, after: 0, remaining: 0 }); console.log(`mode=api; account=${accountRef}; before=0; remaining=0`); process.exit(0); }

// Read-only navigation captures a same-origin batchexecute request template and its dynamic `at` token.
evalBrowser(`(()=>{window.__geminApiReqs=[];const oo=XMLHttpRequest.prototype.open,os=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(m,u){this.__geminUrl=u;return oo.apply(this,arguments)};XMLHttpRequest.prototype.send=function(b){try{window.__geminApiReqs.push({url:this.__geminUrl||'',body:typeof b==='string'?b:''})}catch{};return os.call(this,b)};const of=window.fetch;window.fetch=async function(...a){try{window.__geminApiReqs.push({url:String(a[0]),body:typeof a[1]?.body==='string'?a[1].body:''})}catch{};return of.apply(this,a)};return true})()`);
// 自定义元素的 :first-child 在不同渲染状态下可能匹配不到；
// 让 agent-browser 点击 selector 下第一个实际链接，触发稳定的只读列表请求。
runBrowser(['click', `${chatSelector} a`]);
runBrowser(['wait', '1000']);
const payload = evalBrowser(`(()=>{const reqs=window.__geminApiReqs||[];const t=reqs.find(x=>x.url.includes('batchexecute')&&x.body.includes('at='))||reqs.find(x=>x.url.includes('batchexecute'));const ids=[...document.querySelectorAll(${q(`${chatSelector} a`)})].map(a=>a.href.split('/').pop()).filter(Boolean);const readPath=(root,path)=>path.split('.').reduce((v,k)=>v?.[k],root);const runtimeAt=readPath(window,${q(atGlobalPath)});const at=(t?.body?new URLSearchParams(t.body).get('at'):'')||(typeof runtimeAt==='string'?runtimeAt:'');if(!at)return {error:'api-template-missing',ids};const u=new URL(t?.url||'/_/BardChatUi/data/batchexecute',location.origin);u.searchParams.set('rpcids','GzXR5e');if(!u.searchParams.has('source-path'))u.searchParams.set('source-path',location.pathname);return {url:u.pathname+u.search,at,ids}})()`);
if (payload.error || !payload.at || !Array.isArray(payload.ids)) fail(payload.error || 'API 模板不完整，已停止。');
if (dryRun) { audit(accountRef, { action: 'dry-run-api', mode: 'api', before, after: before, candidates: payload.ids.length }); console.log(`mode=api; account=${accountRef}; before=${before}; candidates=${payload.ids.length}; dryRun=true`); process.exit(0); }

const result = evalBrowser(`(async()=>{const ids=${JSON.stringify(payload.ids)};const endpoint=${q(payload.url)};const at=${q(payload.at)};const concurrency=${concurrency};const maxRetries=${maxRetries};const minMs=${jitterMinMs};const maxMs=${jitterMaxMs};const sleep=ms=>new Promise(r=>setTimeout(r,ms));const encode=id=>{const req=[[['GzXR5e',JSON.stringify(['c_'+id]),null,'generic']]];return 'f.req='+encodeURIComponent(JSON.stringify(req))+'&at='+encodeURIComponent(at)};let next=0,done=0,errors=[];async function worker(){while(true){const i=next++;if(i>=ids.length)return;const id=ids[i];let ok=false;for(let retry=0;retry<=maxRetries&&!ok;retry++){await sleep(Math.floor(minMs+Math.random()*(maxMs-minMs+1)));try{const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:encode(id),credentials:'include'});if(!res.ok){if(!(${isRetryableApiStatus.toString()})(res.status)||retry===maxRetries)throw new Error('HTTP '+res.status);continue}ok=true;done++}catch(e){if(retry===maxRetries)errors.push({id,error:String(e)})}}}}await Promise.all(Array.from({length:concurrency},worker));return {attempted:ids.length,done,errors}})()`);
audit(accountRef, { action: 'api-delete', mode: 'api', before, attempted: result.attempted, done: result.done, errors: result.errors });
if (result.errors?.length) fail(`API 删除存在失败项：${result.errors.length}`);
runBrowser(['reload']);
runBrowser(['wait', String(waitMs)]);
const after = Number(evalBrowser(`document.querySelectorAll(${q(chatSelector)}).length`));
audit(accountRef, { action: 'complete', mode: 'api', before, after, remaining: after });
if (after !== 0) fail(`刷新复查未归零：${before} -> ${after}`);
console.log(`mode=api; account=${accountRef}; before=${before}; attempted=${result.attempted}; deleted=${result.done}; remaining=${after}; audit=${auditPath}`);
