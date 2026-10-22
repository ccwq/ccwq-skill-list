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
  #mobile-toggle { display: inline-block; }
  .hide-narrow { display: none; }
  col.c-time { width: 104px; }
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
  <label for="f-evidence">评分</label><select id="f-evidence">
    <option value="">全部</option><option value="has">有证据</option>
    <option value="rated">已评分</option><option value="unrated">未评分</option></select>
  <label for="view-group">分组</label><select id="view-group">
    <option value="type">按类型</option><option value="">不分组</option>
    <option value="status">按状态</option><option value="group">按存储分组</option>
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
  <button id="reload">重新加载</button>
  <button id="mobile-toggle">列表 / 编辑</button>
</div>
<div id="main">
  <div id="list" role="region" aria-label="记忆列表"></div>
  <section id="editor" class="hidden" aria-label="编辑区">
    <div id="editor-head">编辑</div>
    <div id="editor-body">
      <div id="editor-meta"></div>
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
  q: '', fType: '', fStatus: '', fGroup: '', fEvidence: '',
  viewGroup: 'type', sortKey: 'created_at', sortDesc: true, colorMode: 'type',
  collapsed: {}, selectedId: null,
  edit: { status: 'clean', draft: null, baseline: null, message: '' },
};

var $ = function (id) { return document.getElementById(id); };
var els = {
  q: $('q'), fType: $('f-type'), fStatus: $('f-status'), fGroup: $('f-group'),
  fEvidence: $('f-evidence'), viewGroup: $('view-group'), sortKey: $('sort-key'),
  sortDir: $('sort-dir'), colorMode: $('color-mode'), reload: $('reload'),
  list: $('list'), editor: $('editor'), editorMeta: $('editor-meta'),
  eType: $('e-type'), eStatus: $('e-status'), eContent: $('e-content'),
  saveBtn: $('save-btn'), resetBtn: $('reset-btn'), dirtyFlag: $('dirty-flag'),
  statusLine: $('status-line'), banner: $('banner'), mobileToggle: $('mobile-toggle'),
};

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
    state.snapshot = r.body;
    state.records = r.body.records || [];
    state.groups = r.body.groups || [];
    state.readOnly = !!r.body.read_only;
    if (state.readOnly) {
      var msgs = (r.body.diagnostics || []).map(function (d) { return d.message; });
      showBanner('库损坏或格式不支持，只读诊断模式：' + msgs.join('；'));
    } else {
      showBanner('');
    }
    rebuildGroupFilter();
    render();
    var msg = '共 ' + state.records.length + ' 条 · 修订 ' + r.body.store_revision.slice(0, 8);
    if (state.readOnly) msg += ' · 只读';
    setStatus(msg);
    if (state.selectedId && !findRecord(state.selectedId)) closeEditor();
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
  var body = document.createElement('td'); body.textContent = r.content.replace(/\\s+/g, ' ');
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
      state.snapshot = r.body.snapshot;
      state.records = r.body.snapshot.records || [];
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
els.mobileToggle.addEventListener('click', function () {
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
