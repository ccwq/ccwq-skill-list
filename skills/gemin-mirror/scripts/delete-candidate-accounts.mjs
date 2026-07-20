#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const argv = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (!token.startsWith('--')) continue;
  const key = token.slice(2);
  const next = process.argv[i + 1];
  argv.set(key, next && !next.startsWith('--') ? next : true);
  if (next && !next.startsWith('--')) i += 1;
}
if (!argv.has('confirm-delete-all')) {
  throw new Error('需要 --confirm-delete-all；仅删除候选会话列表中运行时发现的账号。');
}

const cdp = String(argv.get('cdp') || process.env.CDP_PORT || 9696);
const session = String(argv.get('session') || process.env.AGENT_BROWSER_SESSION || process.cwd().replace(/[^a-zA-Z0-9._-]/g, '') || 'gemin-mirror');
const childRunner = new URL('./delete-sessions-via-api.mjs', import.meta.url);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} exited ${result.status}`);
  return (result.stdout || '').trim();
}

function parseOutput(raw) {
  const text = raw.trim();
  try { return JSON.parse(text); } catch { /* agent-browser may add a status line */ }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last >= first) return JSON.parse(text.slice(first, last + 1));
  throw new Error(`无法解析浏览器输出：${text.slice(0, 200)}`);
}

function browser(command, ...args) {
  // Windows cmd 会二次解释 eval 中的引号和正则；统一走 batch JSON stdin。
  return run('agent-browser', ['--cdp', cdp, '--session', session, 'batch'], {
    shell: process.platform === 'win32',
    input: JSON.stringify([[command, ...args]]),
  });
}

function evaluate(expression) {
  return parseOutput(browser('eval', expression));
}

function wait(ms) {
  browser('wait', String(ms));
}

const dashboardHost = `([...document.querySelectorAll('body > div')].find(e=>e.shadowRoot?.querySelector('.dash-banner-menu')))`;

function candidates() {
  return evaluate(`(()=>[...document.querySelectorAll('#_my_chat_list_container .-my-chat-account')].map(c=>{const raw=c.querySelector('.account-id')?.textContent||'';const id=raw.slice(raw.indexOf('#')).trim();const count=Number((c.querySelector('.chat-count')?.textContent||'').match(/\\d+/)?.[0]||0);return {id,count}}).filter(x=>x.id&&x.count>0))()`);
}

function ensurePanel() {
  const initial = evaluate(`(()=>{const host=${dashboardHost};const panel=host?.shadowRoot?.querySelector('.account-panel.dashboard-item');if(panel)return {ready:true};const button=host?.shadowRoot?.querySelector('.dash-banner-menu > button.dash-banner-btn');if(!button)return {ready:false,error:'dashboard-menu-missing'};button.click();return {ready:false}})()`);
  if (initial.ready) return;
  if (initial.error) throw new Error(initial.error);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    wait(1000);
    const state = evaluate(`(()=>{const host=${dashboardHost};return {ready:!!host?.shadowRoot?.querySelector('.account-panel.dashboard-item')}})()`);
    if (state.ready) return;
  }
  throw new Error('账号面板未在限定时间内加载。');
}

function switchTo(id) {
  ensurePanel();
  const state = evaluate(`(()=>{const target=${JSON.stringify(id)};const host=${dashboardHost};const panel=host?.shadowRoot?.querySelector('.account-panel.dashboard-item');const cards=[...panel?.querySelectorAll('.account-card')||[]];const matches=cards.filter(c=>(c.querySelector('.account-id')?.textContent||'').trim().startsWith(target));if(matches.length!==1)return {ok:false,error:'target-card-not-unique'};matches[0].click();return {ok:true}})()`);
  if (!state.ok) throw new Error(state.error);
  wait(3000);
  ensurePanel();
  const proof = evaluate(`(()=>{const target=${JSON.stringify(id)};const host=${dashboardHost};const panel=host?.shadowRoot?.querySelector('.account-panel.dashboard-item');const selected=[...panel?.querySelectorAll('.account-card.selected')||[]];const selectedMatch=selected.length===1&&(selected[0].querySelector('.account-id')?.textContent||'').trim().startsWith(target);const emails=[...document.querySelectorAll('.mavatar-footer-left')].map(e=>{const label=e.getAttribute('aria-label')||e.textContent||'';return label.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)?.[0]||''}).filter(Boolean);return {selectedMatch,email:emails.length===1?emails[0]:'',native:document.querySelectorAll('#sidenav-section-content-chats gem-nav-list-item').length}})()`);
  if (!proof.selectedMatch || !proof.email || proof.native <= 0) throw new Error('账号切换身份核验未通过。');
  return proof;
}

const discovered = candidates();
console.log(`candidates=${discovered.length}`);
for (let index = 0; index < discovered.length; index += 1) {
  const candidate = discovered[index];
  const proof = switchTo(candidate.id);
  console.log(`candidate=${index + 1}/${discovered.length}; before=${proof.native}; verified=true`);
  run(process.execPath, [childRunner.pathname, '--cdp', cdp, '--session', session, '--expected-account', proof.email, '--confirm-delete'], { shell: false });
  wait(1500);
}
console.log(`complete=${discovered.length}`);
