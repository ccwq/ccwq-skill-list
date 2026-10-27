#!/usr/bin/env node
/**
 * Compact viewer page for project-self-memory.
 *
 * The page is a single HTML string. Record data is never embedded; the page
 * reads the access token from the launch URL fragment, keeps it in memory and
 * calls the authenticated API. All record text is rendered via textContent.
 * Page JS deliberately avoids backticks and the sequence "</script>" so the
 * builder can inline it without escaping surprises.
 */

export const VIEWER_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>项目记忆查看器</title>
<style>
:root {
  --border: #c9cfd6; --bg: #ffffff; --bg-alt: #f5f6f8; --text: #1a1d21;
  --muted: #5b636d; --accent: #0b5cad; --danger: #b3261e; --ok: #146c2e;
  --type-experience: #e8f0fe; --type-pitfall: #fce8e6; --type-decision: #e6f4ea;
  --type-constraint: #fef7e0; --type-fact: #f3e8fd;
  --status-active: #e6f4ea; --status-review: #fef7e0; --status-disabled: #eceef1;
  --net-pos: #e6f4ea; --net-neg: #fce8e6; --net-zero: #f5f6f8;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text);
  font: 13px/1.45 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; }
body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
button, input, select, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 6px 12px; border-bottom: 1px solid var(--border); min-height: 38px;
  position: sticky; top: 0; background: var(--bg); z-index: 3; }
#toolbar label { color: var(--muted); white-space: nowrap; }
#toolbar input[type=search] { width: 180px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 3px; }
#toolbar select { padding: 3px 4px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg); }
#toolbar button { padding: 3px 10px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-alt); cursor: pointer; }
#toolbar button:hover { border-color: var(--accent); }
#tag-filter { position: relative; max-width: 100%; }
#tag-filter summary { padding: 3px 10px; border: 1px solid var(--border); border-radius: 3px;
  background: var(--bg-alt); cursor: pointer; }
#tag-options { position: absolute; top: 100%; left: 0; z-index: 4; padding: 6px;
  width: 260px; max-width: calc(100vw - 24px); max-height: 240px; overflow-y: auto;
  background: var(--bg); border: 1px solid var(--border); box-shadow: 0 3px 10px #0002; }
#toolbar #tag-options label { display: flex; gap: 6px; align-items: center;
  white-space: normal; overflow-wrap: anywhere; padding: 3px 0; }
.tag-chip { display: inline-block; max-width: 100%; padding: 0 5px; margin-right: 4px;
  background: var(--bg-alt); border: 1px solid var(--border); border-radius: 3px;
  font-size: 11px; line-height: 18px; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; }
#editor-tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
#editor-tags .tag-chip { white-space: normal; overflow-wrap: anywhere; }
/* 暂存区面板：与编辑器同层的右侧面板，窄屏全屏；徽标沿用 .pill 先例。 */
#cache-btn .count-badge { display: inline-block; min-width: 14px; margin-left: 4px;
  padding: 0 4px; border-radius: 8px; line-height: 16px; font-size: 11px; text-align: center;
  background: var(--accent); border: 1px solid var(--accent); color: #fff; }
#cache-btn.muted .count-badge { background: var(--bg-alt); border-color: var(--border); color: var(--muted); }
#cache-panel { width: 390px; flex: none; border-left: 1px solid var(--border);
  display: flex; flex-direction: column; background: var(--bg); }
#cache-panel.hidden { display: none; }
#cache-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  border-bottom: 1px solid var(--border); font-weight: 600; }
#cache-head .spacer { flex: 1; }
#cache-head button { padding: 2px 8px; border: 1px solid var(--border); border-radius: 3px;
  background: var(--bg-alt); cursor: pointer; }
#cache-head button:hover { border-color: var(--accent); }
#cache-body { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 10px; }
.cache-group { border: 1px solid var(--border); border-radius: 3px; }
.cache-group-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 8px;
  background: var(--bg-alt); border-bottom: 1px solid var(--border); font-weight: 600;
  overflow-wrap: anywhere; }
.cache-group.stale-group { border-color: var(--danger); }
.cache-group .count { color: var(--muted); font-weight: 400; }
.cache-group .warn { color: var(--danger); font-weight: 600; }
.cache-entry { padding: 8px; border-bottom: 1px solid var(--border); display: flex;
  flex-direction: column; gap: 6px; }
.cache-entry:last-child { border-bottom: none; }
.cache-entry .ev { font-size: 12px; color: var(--muted); display: grid;
  grid-template-columns: auto 1fr; gap: 2px 8px; word-break: break-all; }
.cache-entry textarea { width: 100%; min-height: 60px; resize: vertical; padding: 6px;
  border: 1px solid var(--border); border-radius: 3px; font-family: inherit; }
.cache-entry .pair { display: grid; grid-template-columns: 1fr; gap: 4px; }
.cache-entry .pair .old { border-left: 3px solid var(--border); padding: 4px 6px;
  background: var(--bg-alt); white-space: pre-wrap; overflow-wrap: anywhere; }
.cache-entry .pair .old.stale-pair { border-left-color: var(--danger); }
.cache-entry .foot { display: flex; gap: 6px; align-items: center; }
.cache-entry .foot button { padding: 3px 10px; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; }
.cache-entry .foot .write-btn { background: var(--accent); border-color: var(--accent); color: #fff; }
.cache-entry .foot button:disabled { background: var(--muted); border-color: var(--muted); cursor: default; }
.cache-entry .label { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.cache-empty { padding: 24px 0; color: var(--muted); text-align: center; }
.pill.op-add, .pill.op-update { background: var(--type-decision); }
.pill.op-delete { background: var(--type-pitfall); color: var(--danger); }
.pill.op-plus { background: var(--net-pos); color: var(--ok); }
.pill.op-minus { background: var(--net-neg); color: var(--danger); }
.pill.op-stale { background: var(--type-pitfall); color: var(--danger); }
.pill.op-conflict { background: var(--status-review); }
.pill.op-new { background: var(--type-experience); }
#main { display: flex; gap: 0; flex: 1; min-height: 0; }
#list { flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden; position: relative; }
#editor { width: 390px; flex: none; border-left: 1px solid var(--border);
  display: flex; flex-direction: column; background: var(--bg); }
#editor.hidden { display: none; }
.group-head { display: flex; align-items: center; gap: 6px; padding: 4px 12px;
  background: var(--bg-alt); border-bottom: 1px solid var(--border); cursor: pointer;
  font-weight: 600; height: 29px; user-select: none; }
.group-head .count { color: var(--muted); font-weight: 400; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; }
/* 固定列宽（table-layout: fixed 下同作用于 th/td），保证表头与内容纵向对齐 */
col.c-id { width: 56px; }
col.c-type { width: 70px; }
col.c-status { width: 70px; }
col.c-net { width: 72px; }
col.c-pos, col.c-neg { width: 44px; }
col.c-fresh { width: 64px; }
col.c-time { width: 150px; }
thead th { position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--border);
  text-align: left; padding: 4px 6px; font-weight: 600; white-space: nowrap; z-index: 2; }
thead th.num { text-align: right; }
tbody td { border-bottom: 1px solid var(--border); padding: 0 6px; height: 31px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
tbody tr { cursor: pointer; }
tbody tr:hover td { background: var(--bg-alt); }
tbody tr.selected td { background: #e8f0fe; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td .pill { display: inline-block; padding: 0 6px; border-radius: 3px; line-height: 20px;
  border: 1px solid rgba(0, 0, 0, 0.14); }
.c-type-experience { background: var(--type-experience); }
.c-type-pitfall { background: var(--type-pitfall); }
.c-type-decision { background: var(--type-decision); }
.c-type-constraint { background: var(--type-constraint); }
.c-type-fact { background: var(--type-fact); }
.c-status-active { background: var(--status-active); }
.c-status-review { background: var(--status-review); }
.c-status-disabled { background: var(--status-disabled); color: var(--muted); }
.c-net-pos { background: var(--net-pos); color: var(--ok); }
.c-net-neg { background: var(--net-neg); color: var(--danger); }
.c-net-zero { background: var(--net-zero); }
.unrated { color: var(--muted); font-style: normal; }
#editor-head { padding: 6px 10px; border-bottom: 1px solid var(--border); font-weight: 600; }
#editor-body { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; }
#editor-body textarea { width: 100%; min-height: 220px; resize: vertical; padding: 6px;
  border: 1px solid var(--border); border-radius: 3px; font-family: inherit; }
#editor-body .row { display: flex; gap: 6px; align-items: center; }
#editor-body .row label { width: 64px; color: var(--muted); flex: none; }
#editor-body select { flex: 1; padding: 3px 4px; border: 1px solid var(--border); border-radius: 3px; }
#editor-meta { font-size: 12px; color: var(--muted); display: grid;
  grid-template-columns: auto 1fr; gap: 2px 8px; word-break: break-all; }
#editor-foot { border-top: 1px solid var(--border); padding: 6px 10px; display: flex;
  gap: 6px; align-items: center; position: sticky; bottom: 0; background: var(--bg); }
#editor-foot button { padding: 4px 12px; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; }
#save-btn { background: var(--accent); border-color: var(--accent); color: #fff; }
#save-btn:disabled { background: var(--muted); border-color: var(--muted); cursor: default; }
#status-line { padding: 3px 12px; border-top: 1px solid var(--border); color: var(--muted); min-height: 24px; flex: none; }
#status-line.error { color: var(--danger); }
#status-line.conflict { color: var(--danger); font-weight: 600; }
#banner { display: none; padding: 8px 12px; background: #fef7e0; border-bottom: 1px solid var(--border); }
#banner.show { display: block; }
#empty { padding: 24px 12px; color: var(--muted); }
#mobile-toggle { display: none; }
@media (max-width: 767px) {
  #editor { position: fixed; inset: 0; width: auto; z-index: 5; }
  #cache-panel { position: fixed; inset: 0; width: auto; z-index: 5; }
  #cache-body { padding: 8px; }  #mobile-toggle { display: inline-block; }
  .hide-narrow { display: none; }
  .group-head { height: auto; min-height: 29px; overflow-wrap: anywhere; }
  #toolbar input[type=search] { width: 130px; max-width: 100%; }
  #tag-filter { position: static; }
  #tag-options { left: 12px; }
  #tag-filter summary { min-height: 32px; }
  col.c-id { width: 44px; }
  col.c-type, col.c-status { width: 48px; }
  col.c-time { width: 90px; }
  tbody td, thead th { padding: 0 4px; }
  button, select, input { min-height: 32px; }
}
</style>
</head>
<body>
<div id="banner" role="alert"></div>
<div id="toolbar" role="toolbar" aria-label="筛选与视图控制">
  <label for="q">搜索</label><input id="q" type="search" placeholder="正文或 ID">
  <label for="f-type">类型</label><select id="f-type"><option value="">全部</option></select>
  <label for="f-status">状态</label><select id="f-status"><option value="">全部</option></select>
  <label for="f-group" class="hide-narrow">存储分组</label><select id="f-group" class="hide-narrow"><option value="">全部</option></select>
  <details id="tag-filter"><summary id="tag-summary">标签 · 全部</summary>
    <div id="tag-options" role="group" aria-label="标签多选，任一匹配"></div></details>
  <label for="f-evidence">评分</label><select id="f-evidence">
    <option value="">全部</option><option value="has">有证据</option>
    <option value="rated">已评分</option><option value="unrated">未评分</option></select>
  <label for="view-group">分组</label><select id="view-group">
    <option value="type">按类型</option><option value="">不分组</option>
    <option value="status">按状态</option><option value="tag">按标签</option><option value="group">按存储分组</option>
    <option value="month">按创建月份</option></select>
  <label for="sort-key">排序</label><select id="sort-key">
    <option value="created_at">创建时间</option><option value="id">ID</option>
    <option value="positive">正分</option><option value="negative">负分</option>
    <option value="net">净分</option><option value="freshness">新鲜度</option>
    <option value="length">正文长度</option></select>
  <button id="sort-dir" aria-label="切换升降序">降序 ↓</button>
  <label for="color-mode">上色</label><select id="color-mode">
    <option value="type">按类型</option><option value="status">按状态</option>
    <option value="net">按净分</option><option value="">不上色</option></select>
  <button id="cache-btn" aria-label="打开或关闭暂存区面板">暂存区<span id="cache-badge" class="count-badge" hidden></span></button>  <button id="reload">重新加载</button>
  <button id="mobile-toggle">列表 / 编辑</button>
</div>
<div id="main">
  <div id="list" role="region" aria-label="记忆列表"></div>
  <section id="editor" class="hidden" aria-label="编辑区">
    <div id="editor-head">编辑</div>
    <div id="editor-body">
      <div id="editor-meta"></div>
      <div id="editor-tags" aria-label="派生标签（只读）"></div>
      <div class="row"><label for="e-type">类型</label><select id="e-type"></select></div>
      <div class="row"><label for="e-status">状态</label><select id="e-status"></select></div>
      <label for="e-content">正文</label>
      <textarea id="e-content" spellcheck="false"></textarea>
    </div>
    <div id="editor-foot">
      <button id="save-btn">保存 (Ctrl+S)</button>
      <button id="reset-btn">重置草稿</button>
      <span id="dirty-flag" aria-live="polite"></span>
    </div>
  </section>
    <section id="cache-panel" class="hidden" aria-label="暂存区">
    <div id="cache-head">暂存区<span class="spacer"></span>
      <button id="cache-prune">清理已处理</button>
      <button id="cache-refresh">刷新</button>
      <button id="cache-close">关闭</button></div>
    <div id="cache-body"></div>
  </section>
</div>
<div id="status-line" role="status"></div>
<script>
(function () {
'use strict';
var TYPE_LABEL = { experience: '经验', pitfall: '避坑', decision: '决策', constraint: '约束', fact: '事实' };
var STATUS_LABEL = { active: '启用', review: '待复核', disabled: '停用' };
var TYPES = ['experience', 'pitfall', 'decision', 'constraint', 'fact'];
var STATUSES = ['active', 'review', 'disabled'];

// Token hand-off: the fragment never reaches the server or history. A
// fragment-only change does not reload the page, so the token is kept in
// sessionStorage (tab-scoped, cleared with the tab) and the fragment is
// removed immediately. A full reload without the stored token means the
// launch URL must be re-opened; the page never falls back to unauthenticated
// access.
var token = '';
try {
  if (location.hash.indexOf('#token=') === 0) {
    token = location.hash.slice(7);
    sessionStorage.setItem('psm-viewer-token', token);
  } else {
    token = sessionStorage.getItem('psm-viewer-token') || '';
  }
} catch (e) { /* storage may be unavailable; memory token still works */ }
if (location.hash.indexOf('#token=') === 0) {
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* best effort */ }
}

var state = {
  snapshot: null, records: [], groups: [], readOnly: false,
  q: '', fType: '', fStatus: '', fGroup: '', fEvidence: '', fTags: [],
  viewGroup: 'type', sortKey: 'created_at', sortDesc: true, colorMode: 'type',
  collapsed: {}, selectedId: null,
  edit: { status: 'clean', draft: null, baseline: null, message: '' },
  cacheDrafts: {}, cacheBusy: false,};

var $ = function (id) { return document.getElementById(id); };
var els = {
  q: $('q'), fType: $('f-type'), fStatus: $('f-status'), fGroup: $('f-group'),
  fEvidence: $('f-evidence'), viewGroup: $('view-group'), sortKey: $('sort-key'),
  sortDir: $('sort-dir'), colorMode: $('color-mode'), reload: $('reload'),
  list: $('list'), editor: $('editor'), editorMeta: $('editor-meta'), editorTags: $('editor-tags'),
  tagOptions: $('tag-options'), tagSummary: $('tag-summary'),
  eType: $('e-type'), eStatus: $('e-status'), eContent: $('e-content'),
  saveBtn: $('save-btn'), resetBtn: $('reset-btn'), dirtyFlag: $('dirty-flag'),
  statusLine: $('status-line'), banner: $('banner'), mobileToggle: $('mobile-toggle'),
  cacheBtn: $('cache-btn'), cacheBadge: $('cache-badge'), cachePanel: $('cache-panel'),
  cacheBody: $('cache-body'), cachePrune: $('cache-prune'),
  cacheRefresh: $('cache-refresh'), cacheClose: $('cache-close'),};

function fillSelect(el, values, labels) {
  for (var i = 0; i < values.length; i++) {
    var o = document.createElement('option');
    o.value = values[i]; o.textContent = labels[values[i]] || values[i];
    el.appendChild(o);
  }
}
fillSelect(els.fType, TYPES, TYPE_LABEL);
fillSelect(els.fStatus, STATUSES, STATUS_LABEL);
fillSelect(els.eType, TYPES, TYPE_LABEL);
fillSelect(els.eStatus, STATUSES, STATUS_LABEL);

function setStatus(text, kind) {
  els.statusLine.textContent = text || '';
  els.statusLine.className = kind || '';
}
function showBanner(text) {
  els.banner.textContent = text || '';
  els.banner.className = text ? 'show' : '';
}

function api(pathname, options) {
  options = options || {};
  options.headers = Object.assign({ Authorization: 'Bearer ' + token }, options.headers || {});
  return fetch(pathname, options).then(function (res) {
    return res.json().then(function (body) {
      return { status: res.status, body: body };
    });
  });
}

function acceptSnapshot(snapshot) {
  state.snapshot = snapshot;
  state.records = snapshot.records || [];
  state.groups = snapshot.groups || [];
  state.readOnly = !!snapshot.read_only;
  var msgs = (snapshot.diagnostics || []).map(function (d) { return d.message; });
  showBanner(state.readOnly ? '库损坏或格式不支持，只读诊断模式：' + msgs.join('；') : msgs.join('；'));
  rebuildGroupFilter();
  updateCacheBadge();  rebuildTagFilter();
}

function load() {
  if (!token) {
    showBanner('页面令牌已丢失（刷新或手动输入地址所致）。请从本次启动输出的地址重新打开。');
    setStatus('未认证', 'error');
    return;
  }
  setStatus('加载中…');
  api('/api/snapshot').then(function (r) {
    if (r.status === 401) {
      showBanner('访问令牌错误。请使用本次启动输出的完整地址。');
      setStatus('未认证', 'error');
      return;
    }
    if (r.status !== 200) { setStatus('加载失败: ' + (r.body.message || r.status), 'error'); return; }
    acceptSnapshot(r.body);
    render();
    var msg = '共 ' + state.records.length + ' 条 · 修订 ' + r.body.store_revision.slice(0, 8);
    if (state.readOnly) msg += ' · 只读';
    setStatus(msg);
    if (state.selectedId && !findRecord(state.selectedId)) closeEditor();
    if (!els.cachePanel.classList.contains('hidden')) renderCache(true);
    else if (state.selectedId) refreshEditorBaseline();
  }).catch(function (e) { setStatus('加载失败: ' + e.message, 'error'); });
}

function rebuildGroupFilter() {
  var current = els.fGroup.value;
  while (els.fGroup.options.length > 1) els.fGroup.remove(1);
  for (var i = 0; i < state.groups.length; i++) {
    var o = document.createElement('option');
    o.value = state.groups[i].id;
    o.textContent = state.groups[i].title + ' (' + state.groups[i].id + ')';
    els.fGroup.appendChild(o);
  }
  els.fGroup.value = current;
}

// v1 快照没有 tags，统一按无标签处理，不改变原有分组与编辑行为。
function recordTags(r) { return Array.isArray(r.tags) ? r.tags : []; }

function updateTagSummary() {
  els.tagSummary.textContent = state.fTags.length ? '标签 · 已选 ' + state.fTags.length + '（任一）' : '标签 · 全部';
}
function rebuildTagFilter() {
  var names = [];
  var add = function (tag) { if (names.indexOf(tag) < 0) names.push(tag); };
  ((state.snapshot.taxonomy || {}).tags || []).forEach(function (rule) { add(rule.name); });
  state.records.forEach(function (r) { recordTags(r).forEach(add); });
  state.fTags = state.fTags.filter(function (tag) { return names.indexOf(tag) >= 0; });
  els.tagOptions.textContent = '';
  var clear = document.createElement('button'); clear.type = 'button'; clear.textContent = '清除筛选';
  clear.addEventListener('click', function () { state.fTags = []; rebuildTagFilter(); render(); });
  els.tagOptions.appendChild(clear);
  if (!names.length) {
    var empty = document.createElement('div'); empty.textContent = '暂无标签'; els.tagOptions.appendChild(empty);
  }
  names.forEach(function (tag) {
    var label = document.createElement('label');
    var input = document.createElement('input'); input.type = 'checkbox'; input.value = tag;
    input.checked = state.fTags.indexOf(tag) >= 0;
    input.addEventListener('change', function () {
      state.fTags = state.fTags.filter(function (value) { return value !== tag; });
      if (input.checked) state.fTags.push(tag);
      updateTagSummary(); render();
    });
    var text = document.createElement('span'); text.textContent = tag;
    label.appendChild(input); label.appendChild(text); els.tagOptions.appendChild(label);
  });
  updateTagSummary();
}

function findRecord(id) {
  for (var i = 0; i < state.records.length; i++) if (state.records[i].id === id) return state.records[i];
  return null;
}

function codePoints(s) { var n = 0; for (var c of s) n++; return n; }

function netScore(r) { return r.positive - r.negative; }

function monthKey(iso) { return String(iso || '').slice(0, 7) || '未知'; }

function filtered() {
  var q = state.q.trim().toLowerCase();
  return state.records.filter(function (r) {
    if (state.fType && r.type !== state.fType) return false;
    if (state.fStatus && r.status !== state.fStatus) return false;
    if (state.fGroup && r.group !== state.fGroup) return false;
    if (state.fTags.length && !recordTags(r).some(function (tag) { return state.fTags.indexOf(tag) >= 0; })) return false;
    if (state.fEvidence === 'has' && !(r.event_count > 0)) return false;
    if (state.fEvidence === 'rated' && !(r.score_event_count > 0)) return false;
    if (state.fEvidence === 'unrated' && !(r.score_event_count === 0)) return false;
    if (q && r.id.indexOf(q) < 0 && r.content.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
}

function compareIds(a, b) {
  // Numeric comparison safe beyond the 2^53 limit: compare by length then lexically.
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : (a > b ? 1 : 0);
}

function sortRecords(list) {
  var key = state.sortKey, dir = state.sortDesc ? -1 : 1;
  var val = function (r) {
    if (key === 'net') return netScore(r);
    if (key === 'length') return codePoints(r.content);
    if (key === 'created_at') return r.created_at || '';
    return r[key];
  };
  return list.slice().sort(function (a, b) {
    var va = val(a), vb = val(b), c = 0;
    if (typeof va === 'number' && typeof vb === 'number') c = va - vb;
    else c = va < vb ? -1 : (va > vb ? 1 : 0);
    if (c === 0) c = compareIds(a.id, b.id); // stable secondary order
    return c * dir;
  });
}

function groupKey(r) {
  if (state.viewGroup === 'type') return 'type:' + r.type;
  if (state.viewGroup === 'status') return 'status:' + r.status;
  if (state.viewGroup === 'group') return 'group:' + (r.group || '');
  if (state.viewGroup === 'tag') return 'tag:' + (recordTags(r)[0] || '');
  if (state.viewGroup === 'month') return 'month:' + monthKey(r.created_at);
  return '';
}
function groupTitle(key) {
  if (!key) return '';
  var p = key.split(':'), kind = p[0], v = p.slice(1).join(':');
  if (kind === 'type') return TYPE_LABEL[v] || v;
  if (kind === 'status') return STATUS_LABEL[v] || v;
  if (kind === 'group') {
    if (!v) return '未分组';
    for (var i = 0; i < state.groups.length; i++) if (state.groups[i].id === v) return state.groups[i].title;
    return v;
  }
  if (kind === 'tag') return v || '未标记';
  if (kind === 'month') return v + ' (UTC)';
  return key;
}
function groupOrder(key) {
  var order = { type: TYPES, status: STATUSES };
  var kind = key.split(':')[0], v = key.slice(kind.length + 1);
  if (order[kind]) { var i = order[kind].indexOf(v); return (i < 0 ? 99 : i) + ''; }
  if (kind === 'month') return v;
  return v;
}

function pill(cls, text) {
  var s = document.createElement('span');
  s.className = 'pill ' + cls; s.textContent = text;
  return s;
}

function tagChip(tag) {
  var chip = document.createElement('span');
  chip.className = 'tag-chip'; chip.textContent = tag; chip.title = tag;
  return chip;
}

function netCell(r) {
  var td = document.createElement('td'); td.className = 'num';
  if (r.score_event_count === 0) {
    var s = document.createElement('span'); s.className = 'unrated'; s.textContent = '未评分';
    td.appendChild(s);
    if (r.event_count > 0) {
      // 仅有谱系等非评分事件时同时显示「有证据」，与评分事件数明确区分（规格）
      var ev = document.createElement('span'); ev.className = 'unrated';
      ev.textContent = ' · 有证据'; ev.title = '当前版本有 ' + r.event_count + ' 条非评分事件';
      td.appendChild(ev);
    }
  } else {
    var net = netScore(r);
    var cls = net > 0 ? 'c-net-pos' : (net < 0 ? 'c-net-neg' : 'c-net-zero');
    td.appendChild(pill(cls, (net > 0 ? '+' : '') + net));
  }
  return td;
}

function render() {
  els.list.textContent = '';
  var list = sortRecords(filtered());
  if (!list.length) {
    var d = document.createElement('div'); d.id = 'empty';
    d.textContent = state.records.length ? '无符合筛选条件的记录' : '库中没有记录';
    els.list.appendChild(d); return;
  }
  var groups = {};
  var order = [];
  for (var i = 0; i < list.length; i++) {
    var k = groupKey(list[i]);
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(list[i]);
  }
  if (state.viewGroup) {
    order.sort(function (a, b) {
      var ga = groupOrder(a), gb = groupOrder(b);
      if (state.viewGroup === 'month') return ga < gb ? 1 : (ga > gb ? -1 : 0);
      return ga < gb ? -1 : (ga > gb ? 1 : 0);
    });
  }
  for (var gi = 0; gi < order.length; gi++) {
    var key = order[gi], recs = groups[key];
    if (state.viewGroup) {
      var head = document.createElement('div');
      head.className = 'group-head'; head.setAttribute('role', 'button');
      head.tabIndex = 0;
      var isCollapsed = !!state.collapsed[key];
      head.textContent = (isCollapsed ? '▸ ' : '▾ ') + groupTitle(key) + ' ';
      var cnt = document.createElement('span'); cnt.className = 'count';
      cnt.textContent = recs.length + ' 条';
      head.appendChild(cnt);
      head.addEventListener('click', toggleGroup(key));
      head.addEventListener('keydown', groupKeydown(key));
      els.list.appendChild(head);
      if (isCollapsed) continue;
    }
    els.list.appendChild(buildTable(recs));
  }
}
function toggleGroup(key) {
  return function () { state.collapsed[key] = !state.collapsed[key]; render(); };
}
function groupKeydown(key) {
  return function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.collapsed[key] = !state.collapsed[key]; render(); }
  };
}

function buildTable(recs) {
  var table = document.createElement('table');
  var cg = document.createElement('colgroup');
  ['c-id', 'c-type', 'c-status', 'c-net hide-narrow', 'c-pos hide-narrow',
   'c-neg hide-narrow', 'c-fresh hide-narrow', 'c-time', 'c-body'].forEach(function (cls) {
    var col = document.createElement('col');
    cls.split(' ').forEach(function (c) { col.classList.add(c); });
    cg.appendChild(col);
  });
  table.appendChild(cg);
  var thead = document.createElement('thead');
  var hr = document.createElement('tr');
  ['ID', '类型', '状态', '净分', '正', '负', '新鲜度', '创建时间', '正文'].forEach(function (h, i) {
    var th = document.createElement('th'); th.textContent = h;
    if (i >= 3 && i <= 6) th.className = 'num hide-narrow';
    hr.appendChild(th);
  });
  thead.appendChild(hr); table.appendChild(thead);
  var tb = document.createElement('tbody');
  for (var i = 0; i < recs.length; i++) tb.appendChild(buildRow(recs[i]));
  table.appendChild(tb);
  return table;
}

function buildRow(r) {
  var tr = document.createElement('tr');
  if (r.id === state.selectedId) tr.className = 'selected';
  tr.addEventListener('click', function () { selectRecord(r.id); });
  var cells = [];
  var idTd = document.createElement('td'); idTd.textContent = r.id; cells.push(idTd);
  var typeTd = document.createElement('td');
  var statusTd = document.createElement('td');
  if (state.colorMode === 'type') {
    typeTd.appendChild(pill('c-type-' + r.type, TYPE_LABEL[r.type] || r.type));
    statusTd.textContent = STATUS_LABEL[r.status] || r.status;
  } else if (state.colorMode === 'status') {
    typeTd.textContent = TYPE_LABEL[r.type] || r.type;
    statusTd.appendChild(pill('c-status-' + r.status, STATUS_LABEL[r.status] || r.status));
  } else {
    typeTd.textContent = TYPE_LABEL[r.type] || r.type;
    statusTd.textContent = STATUS_LABEL[r.status] || r.status;
  }
  cells.push(typeTd); cells.push(statusTd);
  var net = netCell(r); net.classList.add('hide-narrow'); cells.push(net);
  var pos = document.createElement('td'); pos.className = 'num hide-narrow';
  pos.textContent = r.score_event_count === 0 ? '—' : String(r.positive); cells.push(pos);
  var neg = document.createElement('td'); neg.className = 'num hide-narrow';
  neg.textContent = r.score_event_count === 0 ? '—' : String(r.negative); cells.push(neg);
  var fresh = document.createElement('td'); fresh.className = 'num hide-narrow';
  fresh.textContent = r.freshness.toFixed(2);
  fresh.title = '规则估算的新鲜度（按类型半衰期），不代表内容已验证'; cells.push(fresh);
  var time = document.createElement('td'); time.textContent = (r.created_at || '').replace('T', ' ').replace('Z', ''); cells.push(time);
  var body = document.createElement('td');
  // 标签分组已在标题显示首标签，行内保留其余标签；其他视图显示全部。
  var tags = recordTags(r); body.title = tags.join(' · ') + (tags.length ? '\\n' : '') + r.content;
  (state.viewGroup === 'tag' ? tags.slice(1) : tags).forEach(function (tag) { body.appendChild(tagChip(tag)); });
  var preview = document.createElement('span'); preview.textContent = r.content.replace(/\\s+/g, ' ');
  body.appendChild(preview);
  cells.push(body);
  if (state.colorMode === 'net') {
    var n = netScore(r);
    if (r.score_event_count > 0) tr.style.background = n > 0 ? 'var(--net-pos)' : (n < 0 ? 'var(--net-neg)' : 'var(--net-zero)');
  }
  for (var i = 0; i < cells.length; i++) tr.appendChild(cells[i]);
  return tr;
}

function selectRecord(id) {
  if (state.edit.status === 'dirty' && state.selectedId && state.selectedId !== id) {
    if (!confirm('当前记录有未保存修改，切换将丢弃草稿。继续？')) return;
  }
  state.selectedId = id;
  openEditor();
  render();
}

function openEditor() {
  var r = findRecord(state.selectedId);
  if (!r) { closeEditor(); return; }
  els.editor.classList.remove('hidden');
  state.edit.status = 'clean';
  state.edit.draft = { content: r.content, type: r.type, status: r.status };
  state.edit.baseline = { content: r.content, type: r.type, status: r.status };
  renderEditor(r);
}
function closeEditor() {
  state.selectedId = null;
  state.edit = { status: 'clean', draft: null, baseline: null, message: '' };
  els.editor.classList.add('hidden');
}
function refreshEditorBaseline() {
  var r = findRecord(state.selectedId);
  if (!r || !state.edit.draft) return;
  if (state.edit.status === 'clean') {
    state.edit.draft = { content: r.content, type: r.type, status: r.status };
    state.edit.baseline = { content: r.content, type: r.type, status: r.status };
    renderEditor(r);
  }
  // dirty/conflict: never overwrite the user's draft silently.
}

function renderEditor(r) {
  var meta = els.editorMeta; meta.textContent = '';
  var pairs = [
    ['ID', r.id],
    ['创建时间', r.created_at],
    ['版本', r.record_version.slice(0, 12) + '…'],
    ['评分', r.score_event_count === 0 ? '未评分' : ('+' + r.positive + ' / -' + r.negative + '（净 ' + netScore(r) + '）')],
    ['证据事件', String(r.event_count)],
    ['最后评分', r.last_scored_at || '—'],
  ];
  for (var i = 0; i < pairs.length; i++) {
    var dt = document.createElement('div'); dt.textContent = pairs[i][0];
    var dd = document.createElement('div'); dd.textContent = pairs[i][1];
    meta.appendChild(dt); meta.appendChild(dd);
  }
  els.editorTags.textContent = '';
  var tags = recordTags(r);
  if (!tags.length) els.editorTags.textContent = '标签：未标记';
  tags.forEach(function (tag) { els.editorTags.appendChild(tagChip(tag)); });
  els.eContent.value = state.edit.draft.content;
  els.eType.value = state.edit.draft.type;
  els.eStatus.value = state.edit.draft.status;
  els.eContent.disabled = state.readOnly || state.edit.status === 'saving';
  els.eType.disabled = els.eContent.disabled;
  els.eStatus.disabled = els.eContent.disabled;
  updateDirtyFlag();
}

function updateDirtyFlag() {
  var d = state.edit.draft, b = state.edit.baseline;
  var dirty = d && b && (d.content !== b.content || d.type !== b.type || d.status !== b.status);
  if (dirty && state.edit.status === 'clean') state.edit.status = 'dirty';
  if (!dirty && state.edit.status === 'dirty') state.edit.status = 'clean';
  els.dirtyFlag.textContent = state.edit.status === 'dirty' ? '未保存' :
    state.edit.status === 'saving' ? '保存中…' :
    state.edit.status === 'saved' ? '已保存' :
    state.edit.status === 'conflict' ? '冲突' : '';
  els.saveBtn.disabled = state.readOnly || state.edit.status === 'saving' || state.edit.status === 'clean';
}

function markDraft() {
  if (!state.edit.draft) return;
  state.edit.draft.content = els.eContent.value;
  state.edit.draft.type = els.eType.value;
  state.edit.draft.status = els.eStatus.value;
  updateDirtyFlag();
}

function save() {
  if (!state.selectedId || !state.edit.draft) return;
  if (state.edit.status === 'saving') return;
  if (state.readOnly) { setStatus('库为只读，无法保存', 'error'); return; }
  var draft = Object.assign({}, state.edit.draft);
  var recordId = state.selectedId;
  state.edit.status = 'saving';
  updateDirtyFlag();
  setStatus('保存中…');
  api('/api/records/' + recordId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      store_revision: state.snapshot.store_revision,
      content: draft.content, type: draft.type, status: draft.status,
    }),
  }).then(function (r) {
    if (r.status === 200) {
      acceptSnapshot(r.body.snapshot);
      if (r.body.applied) {
        state.edit.status = 'saved';
        state.edit.baseline = draft;
        setStatus('已保存' + (r.body.backup ? ' · 备份: ' + r.body.backup : ''));
      } else {
        state.edit.status = 'clean';
        state.edit.baseline = draft;
        setStatus('无实际变化，未写入');
      }
      render(); renderEditor(findRecord(recordId));
      return;
    }
    if (r.status === 409) {
      state.edit.status = 'conflict';
      setStatus('冲突：' + (r.body.message || '库已被外部修改') + '。草稿已保留；点击「重新加载」获取最新内容，草稿可用 Ctrl+C 从编辑框复制。', 'conflict');
      updateDirtyFlag();
      return;
    }
    if (r.status === 503) {
      state.edit.status = 'dirty';
      setStatus('存储正被其他进程写入（锁忙），请稍后重试。草稿已保留。', 'error');
      updateDirtyFlag();
      return;
    }
    state.edit.status = 'error';
    setStatus('保存失败：' + (r.body.message || ('HTTP ' + r.status)) + '。草稿已保留。', 'error');
    updateDirtyFlag();
  }).catch(function (e) {
    state.edit.status = 'error';
    setStatus('保存失败：' + e.message + '。草稿已保留。', 'error');
    updateDirtyFlag();
  });
}

// ---------------------------------------------------------------------------
// 暂存区面板（cache staging panel）。
// 数据契约：快照 cache 节 { count, groups[] }，组 { key, kind, refid, stale,
// conflict, count, entries[], current }；条目含 cache.jsonl 全部字段 + stale。
// 全部渲染走 textContent/createElement，零 innerHTML。

var CACHE_OP_LABEL = { add: '新增', update: '修订', delete: '删除', '+1': '调分+', '-1': '调分-' };

function cacheSection() {
  var snap = state.snapshot || {};
  // 旧版 server 无 cache 节：按空处理，面板给出空态而非报错。
  return snap.cache || { count: 0, groups: [] };
}

function updateCacheBadge() {
  var info = cacheSection();
  var count = info.count || 0;
  els.cacheBadge.textContent = String(count);
  els.cacheBadge.hidden = count === 0;
  els.cacheBtn.className = count === 0 ? 'muted' : '';
  els.cacheBtn.title = count === 0 ? '暂存区没有待处理项' : '暂存区有 ' + count + ' 条待处理候选';
}

function toggleCachePanel() {
  var hidden = els.cachePanel.classList.toggle('hidden');
  if (!hidden) {
    // 打开时拉一次快照刷新，避免展示陈旧数据（简洁方案）。
    refreshCache(true);
  }
}

function refreshCache(preserveDrafts) {
  if (els.cachePanel.classList.contains('hidden')) return;
  setStatus('加载中…');
  api('/api/snapshot').then(function (r) {
    if (r.status !== 200) { setStatus('加载失败: ' + ((r.body || {}).message || r.status), 'error'); return; }
    acceptSnapshot(r.body);
    render();
    renderCache(preserveDrafts);
    setStatus('共 ' + state.records.length + ' 条 · 修订 ' + r.body.store_revision.slice(0, 8));
  }).catch(function (e) { setStatus('加载失败: ' + e.message, 'error'); });
}

// 渲染整个面板。失败路径不调用本函数（草稿与 DOM 原样保留）。
function renderCache(preserveDrafts) {
  var body = els.cacheBody;
  body.textContent = '';
  var info = cacheSection();
  var gs = info.groups || [];
  if (!(info.count > 0)) {
    var empty = document.createElement('div');
    empty.className = 'cache-empty';
    empty.textContent = '暂存区没有待处理项';
    body.appendChild(empty);
    return;
  }
  for (var i = 0; i < gs.length; i++) body.appendChild(buildCacheGroup(gs[i], preserveDrafts));
}

function buildCacheGroup(group, preserveDrafts) {
  var box = document.createElement('div');
  box.className = 'cache-group' + (group.stale ? ' stale-group' : '');
  var head = document.createElement('div');
  head.className = 'cache-group-head';
  if (group.stale) {
    head.appendChild(pill('op-stale', '失效'));
  } else if (group.kind === 'new') {
    head.appendChild(pill('op-new', '新记录'));
  }
  if (group.refid !== null && group.refid !== undefined) {
    var ref = document.createElement('span'); ref.textContent = '目标 ' + group.refid;
    head.appendChild(ref);
  } else {
    var ref2 = document.createElement('span'); ref2.textContent = '新记录';
    head.appendChild(ref2);
  }
  if (group.conflict) head.appendChild(pill('op-conflict', '冲突'));
  var gcount = document.createElement('span');
  gcount.className = 'count'; gcount.textContent = (group.count || 0) + ' 条';
  head.appendChild(gcount);
  box.appendChild(head);
  for (var i = 0; i < (group.entries || []).length; i++) {
    box.appendChild(buildCacheEntry(group, group.entries[i], preserveDrafts));
  }
  return box;
}

function evidenceRows(entry) {
  var ev = entry.evidence || {};
  var rows = [
    ['理由', ev.reason], ['观察', ev.observation],
    ['来源', ev.kind], ['时间', ev.observed_at],
  ];
  var grid = document.createElement('div'); grid.className = 'ev';
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][1]) continue;
    var dt = document.createElement('div'); dt.textContent = rows[i][0];
    var dd = document.createElement('div'); dd.textContent = rows[i][1];
    grid.appendChild(dt); grid.appendChild(dd);
  }
  return grid;
}

function oldPair(labelText, text, stale) {
  var wrap = document.createElement('div'); wrap.className = 'pair';
  var label = document.createElement('div'); label.className = 'label';
  label.textContent = labelText;
  var old = document.createElement('div'); old.className = 'old' + (stale ? ' stale-pair' : '');
  old.textContent = text;
  wrap.appendChild(label); wrap.appendChild(old);
  return wrap;
}

function buildCacheEntry(group, entry, preserveDrafts) {
  var op = entry.type;
  var stale = entry.stale === true;
  var item = document.createElement('div'); item.className = 'cache-entry';
  var top = document.createElement('div');
  var opPill = pill(op === '+1' ? 'op-plus' : (op === '-1' ? 'op-minus' : 'op-' + op), CACHE_OP_LABEL[op] || op);
  top.appendChild(opPill);
  if (stale) top.appendChild(pill('op-stale', '失效'));
  var src = document.createElement('span');
  src.className = 'label';
  src.textContent = ' · 来源 ' + (entry.source || '—') + ' · 暂存 ' + String(entry.created_at || '').replace('T', ' ').replace('Z', '');
  top.appendChild(src);
  item.appendChild(top);

  // 修订：原正文（base_content）对照；失效：原基准与现状（current.content）双对照。
  if (stale) {
    item.appendChild(oldPair('原基准', entry.base_content == null ? '（无）' : entry.base_content, true));
    var current = group.current;
    item.appendChild(oldPair('现状' + (current && current.exists === false ? '（记录已不存在）' : ''),
      current && current.content ? current.content : '（无）', true));
  } else if (op === 'update') {
    item.appendChild(oldPair('原正文', entry.base_content == null ? '（无）' : entry.base_content, false));
  }

  // 正文：add/update 预填 payload.content 可编辑；失效组无编辑框（只给丢弃）。
  var textarea = null;
  if ((op === 'add' || op === 'update') && !stale && entry.payload && entry.payload.content != null) {
    textarea = document.createElement('textarea');
    textarea.spellcheck = false;
    textarea.value = preserveDrafts && state.cacheDrafts[entry.event_id] != null
      ? state.cacheDrafts[entry.event_id]
      : entry.payload.content;
    textarea.addEventListener('input', function () { state.cacheDrafts[entry.event_id] = textarea.value; });
    item.appendChild(textarea);
  }

  var evGrid = evidenceRows(entry);
  if (evGrid.childNodes.length) item.appendChild(evGrid);

  var foot = document.createElement('div'); foot.className = 'foot';
  var writeBtn = document.createElement('button');
  writeBtn.type = 'button'; writeBtn.className = 'write-btn'; writeBtn.textContent = '写入';
  var dropBtn = document.createElement('button');
  dropBtn.type = 'button'; dropBtn.textContent = '丢弃';
  // 失效组只给「丢弃」，写入入口不提供（失效拒直写）。
  if (stale) {
    foot.appendChild(dropBtn);
  } else {
    writeBtn.addEventListener('click', function () { applyCache(entry, textarea ? textarea.value : null, writeBtn, dropBtn); });
    foot.appendChild(writeBtn);
    foot.appendChild(dropBtn);
  }
  dropBtn.addEventListener('click', function () { discardCache(entry, writeBtn, dropBtn); });
  item.appendChild(foot);
  return item;
}

function setCacheButtonsDisabled(disabled) {
  var buttons = els.cacheBody.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) buttons[i].disabled = disabled;
  els.cachePrune.disabled = disabled;
}

// 失败路径：不重渲染、不清编辑框，草稿保留；setStatus 说明原因（对齐编辑器先例）。
function applyCache(entry, draftContent, writeBtn, dropBtn) {
  if (state.cacheBusy) return;
  if (state.readOnly) { setStatus('库为只读，无法写入暂存候选', 'error'); return; }
  var op = entry.type;
  if ((op === 'delete' || op === '+1' || op === '-1')
    && !confirm((CACHE_OP_LABEL[op] || op) + '候选将直接作用于记录 ' + (entry.target_refid || '') + '，确认写入？')) return;
  state.cacheBusy = true;
  setCacheButtonsDisabled(true);
  setStatus('写入中…');
  var body = { store_revision: state.snapshot.store_revision };
  if (draftContent != null) body.content = draftContent;
  api('/api/cache/' + entry.event_id + '/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (r) {
    if (r.status === 200) {
      acceptSnapshot(r.body.snapshot);
      delete state.cacheDrafts[entry.event_id];
      render(); renderCache(false);
      setStatus('已写入' + (r.body.record_id ? ' · 记录 ' + r.body.record_id : ''));
      return;
    }
    if (r.status === 409) {
      setStatus('冲突：' + ((r.body || {}).message || '库已被外部修改') + '。草稿已保留；点击「重新加载」获取最新内容。', 'conflict');
      return;
    }
    if (r.status === 503) {
      setStatus('存储正被其他进程写入（锁忙），请稍后重试。草稿已保留。', 'error');
      return;
    }
    setStatus('写入失败：' + ((r.body || {}).message || ('HTTP ' + r.status)) + '。草稿已保留。', 'error');
  }).catch(function (e) {
    setStatus('写入失败：' + e.message + '。草稿已保留。', 'error');
  }).then(function () {
    state.cacheBusy = false;
    setCacheButtonsDisabled(false);
  });
}

function discardCache(entry, writeBtn, dropBtn) {
  if (state.cacheBusy) return;
  if (state.readOnly) { setStatus('库为只读，无法丢弃暂存候选', 'error'); return; }
  state.cacheBusy = true;
  setCacheButtonsDisabled(true);
  setStatus('丢弃中…');
  api('/api/cache/' + entry.event_id + '/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_revision: state.snapshot.store_revision }),
  }).then(function (r) {
    if (r.status === 200) {
      acceptSnapshot(r.body.snapshot);
      delete state.cacheDrafts[entry.event_id];
      render(); renderCache(false);
      setStatus('已丢弃');
      return;
    }
    if (r.status === 409) {
      setStatus('冲突：' + ((r.body || {}).message || '候选状态已变化') + '。点击「刷新」获取最新内容。', 'conflict');
      return;
    }
    if (r.status === 503) {
      setStatus('存储正被其他进程写入（锁忙），请稍后重试。', 'error');
      return;
    }
    setStatus('丢弃失败：' + ((r.body || {}).message || ('HTTP ' + r.status)), 'error');
  }).catch(function (e) {
    setStatus('丢弃失败：' + e.message, 'error');
  }).then(function () {
    state.cacheBusy = false;
    setCacheButtonsDisabled(false);
  });
}

function pruneCache() {
  if (state.cacheBusy) return;
  if (state.readOnly) { setStatus('库为只读，无法清理暂存区', 'error'); return; }
  if (!confirm('清理全部已处理与已失效的暂存条目？此操作不可撤销。')) return;
  state.cacheBusy = true;
  setCacheButtonsDisabled(true);
  setStatus('清理中…');
  api('/api/cache/prune', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_revision: state.snapshot.store_revision }),
  }).then(function (r) {
    if (r.status === 200) {
      acceptSnapshot(r.body.snapshot);
      render(); renderCache(false);
      setStatus('已清理 ' + ((r.body || {}).removed != null ? r.body.removed : '?') + ' 条已处理条目');
      return;
    }
    if (r.status === 503) {
      setStatus('存储正被其他进程写入（锁忙），请稍后重试。', 'error');
      return;
    }
    setStatus('清理失败：' + ((r.body || {}).message || ('HTTP ' + r.status)), 'error');
  }).catch(function (e) {
    setStatus('清理失败：' + e.message, 'error');
  }).then(function () {
    state.cacheBusy = false;
    setCacheButtonsDisabled(false);
  });
}
els.q.addEventListener('input', function () { state.q = els.q.value; render(); });
els.fType.addEventListener('change', function () { state.fType = els.fType.value; render(); });
els.fStatus.addEventListener('change', function () { state.fStatus = els.fStatus.value; render(); });
els.fGroup.addEventListener('change', function () { state.fGroup = els.fGroup.value; render(); });
els.fEvidence.addEventListener('change', function () { state.fEvidence = els.fEvidence.value; render(); });
els.viewGroup.addEventListener('change', function () { state.viewGroup = els.viewGroup.value; render(); });
els.sortKey.addEventListener('change', function () { state.sortKey = els.sortKey.value; render(); });
els.sortDir.addEventListener('click', function () {
  state.sortDesc = !state.sortDesc;
  els.sortDir.textContent = state.sortDesc ? '降序 ↓' : '升序 ↑';
  render();
});
els.colorMode.addEventListener('change', function () { state.colorMode = els.colorMode.value; render(); });
els.reload.addEventListener('click', load);
els.eContent.addEventListener('input', markDraft);
els.eType.addEventListener('change', markDraft);
els.eStatus.addEventListener('change', markDraft);
els.saveBtn.addEventListener('click', save);
els.resetBtn.addEventListener('click', function () {
  if (state.edit.baseline) {
    state.edit.draft = Object.assign({}, state.edit.baseline);
    state.edit.status = 'clean';
    renderEditor(findRecord(state.selectedId));
  }
});
els.cacheBtn.addEventListener('click', toggleCachePanel);
els.cacheClose.addEventListener('click', toggleCachePanel);
els.cacheRefresh.addEventListener('click', function () { refreshCache(true); });
els.cachePrune.addEventListener('click', pruneCache);els.mobileToggle.addEventListener('click', function () {
  els.editor.classList.toggle('hidden');
});
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', function (e) {
  if (state.edit.status === 'dirty' || state.edit.status === 'saving') {
    e.preventDefault(); e.returnValue = '';
  }
});

load();
})();
</script>
</body>
</html>
`;
