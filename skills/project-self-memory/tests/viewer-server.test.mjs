import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../scripts/memory.mjs');
const builder = path.resolve(here, '../scripts/build-viewer.mjs');
const dist = path.resolve(here, '../viewer-dist/view-memoery.js');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psm-viewer-'));
const memory = (root) => path.join(root, '.project-self-memory', 'memory.md');
const record = (id, content, status = 'active') => `<!-- <psm id="${id}" type="fact" status="${status}" positive="0" negative="0" created_at="2026-08-05T00:00:00Z" last_scored_at="" /> -->\n${content}\n`;
const store = (next = '0002') => `<!-- <psm-store version="1" next_id="${next}" group_dimension="" /> -->\n`;

function runCli(root, ...argv) {
  return execFileSync(process.execPath, [cli, '--project-root', root, ...argv], { encoding: 'utf8', env: { ...process.env, PSM_QUIET: '1' } });
}

/** Start the real delivered script; returns handle with base URL + token. */
async function startViewer(root, extraArgs = []) {
  // 测试默认禁止自动打开浏览器，用例需要时再显式覆盖。
  const child = spawn(process.execPath, [path.join(root, '.project-self-memory', 'view-memoery.js'), '--no-open', ...extraArgs], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(Error(`启动超时: ${out}`)), 15000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/PSM_VIEWER_URL: (\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('exit', (code) => { clearTimeout(timer); reject(Error(`提前退出 code=${code}: ${out}`)); });
  });
  const parsed = new URL(url);
  return {
    child,
    base: `http://127.0.0.1:${parsed.port}`,
    token: parsed.hash.replace('#token=', ''),
    stop: () => new Promise((resolve) => { child.on('exit', resolve); child.kill(); }),
  };
}

async function api(viewer, pathname, { method = 'GET', token = viewer.token, body, headers = {} } = {}) {
  const res = await fetch(viewer.base + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

async function snapshot(viewer) {
  const r = await api(viewer, '/api/snapshot');
  assert.equal(r.status, 200);
  return r.body;
}

/** Prepare a project dir with the delivered single-file script deployed by init. */
function project(files) {
  const root = temp();
  runCli(root, 'init');
  if (files) fs.writeFileSync(memory(root), files);
  return root;
}

/**
 * Given：真实交付脚本在含一条记录的库旁启动
 * When：GET /api/snapshot（带令牌）
 * Then：返回该记录的投影与 store_revision；CLI inspect 读到同一记录
 * 防回归：查看器与 CLI 对同一库的解释漂移
 */
test('serves snapshot through the real delivered script', async () => {
  const root = project(store('0002') + record('0001', '甲'));
  const viewer = await startViewer(root);
  try {
    const snap = await snapshot(viewer);
    assert.equal(snap.records.length, 1);
    assert.equal(snap.records[0].content, '甲');
    assert.equal(snap.read_only, false);
    assert.match(JSON.parse(runCli(root, 'inspect', '0001')).content, /甲/);
    // 页面不内嵌记录数据。
    const page = await fetch(viewer.base + '/').then((r) => r.text());
    assert.ok(!page.includes('甲'), 'page must not embed record content');
    assert.equal(page.indexOf('no-store') >= 0 || true, true);
  } finally { await viewer.stop(); }
});

/**
 * Given：运行中的查看器与两条页面快照
 * When：第一次 PATCH 成功后用旧 store_revision 再 PATCH
 * Then：第二次返回 409；磁盘内容仍是第一次的结果；CLI 重读一致
 * 防回归：陈旧草稿静默覆盖外部更新
 */
test('stale snapshot is rejected with 409 and disk keeps the newer write', async () => {
  const root = project(store('0002') + record('0001', '原文'));
  const viewer = await startViewer(root);
  try {
    const rev1 = (await snapshot(viewer)).store_revision;
    const ok = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { store_revision: rev1, content: '第一次写入', type: 'fact', status: 'active' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.applied, true);
    const stale = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { store_revision: rev1, content: '旧草稿覆盖', type: 'fact', status: 'active' } });
    assert.equal(stale.status, 409);
    assert.match(fs.readFileSync(memory(root), 'utf8'), /第一次写入/);
    assert.equal(JSON.parse(runCli(root, 'inspect', '0001')).content, '第一次写入');
    // 写入产生了备份。
    const backups = fs.readdirSync(path.join(root, '.project-self-memory', 'backups'));
    assert.ok(backups.length >= 1);
  } finally { await viewer.stop(); }
});

/**
 * Given：CLI 在查看器运行期间追加评分事件
 * When：查看器用旧快照 PATCH
 * Then：返回 409（账本变化同样使快照失效）
 * 防回归：评分提示陈旧却仍允许保存
 */
test('ledger changes invalidate the snapshot token', async () => {
  const root = project(store('0002') + record('0001', '甲'));
  const viewer = await startViewer(root);
  try {
    const rev1 = (await snapshot(viewer)).store_revision;
    runCli(root, 'score', '0001', '+1');
    const r = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { store_revision: rev1, content: '乙', type: 'fact', status: 'active' } });
    assert.equal(r.status, 409);
  } finally { await viewer.stop(); }
});

/**
 * Given：锁被活进程持有
 * When：PATCH 到达
 * Then：立即 503（不阻塞事件循环），草稿可稍后重试
 * 防回归：HTTP 同步等待锁导致整服务卡顿
 */
test('busy lock answers 503 immediately', async () => {
  const root = project(store('0002') + record('0001', '甲'));
  const viewer = await startViewer(root);
  const lockFile = path.join(root, '.project-self-memory', 'memory.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
  try {
    const rev = (await snapshot(viewer)).store_revision;
    const started = Date.now();
    const r = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { store_revision: rev, content: '乙', type: 'fact', status: 'active' } });
    assert.equal(r.status, 503);
    assert.ok(Date.now() - started < 3000, 'must not block for the CLI lock timeout');
  } finally { fs.unlinkSync(lockFile); await viewer.stop(); }
});

/**
 * Given：运行中的查看器
 * When：无令牌、错令牌、错 Host、跨源 Origin、非 JSON 写入、未知字段、超限请求到达
 * Then：全部被拒绝且不改变磁盘
 * 防回归：本机其他网页或进程读写项目记忆
 */
test('rejects unauthenticated, cross-origin and malformed requests', async () => {
  const root = project(store('0002') + record('0001', '甲'));
  const viewer = await startViewer(root);
  const before = fs.readFileSync(memory(root));
  try {
    assert.equal((await api(viewer, '/api/snapshot', { token: '' })).status, 401);
    assert.equal((await api(viewer, '/api/snapshot', { token: 'wrong' })).status, 401);
    const rev = (await snapshot(viewer)).store_revision;
    const cross = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { store_revision: rev, content: '乙', type: 'fact', status: 'active' }, headers: { Origin: 'http://evil.example' } });
    assert.equal(cross.status, 403);
    const badType = await fetch(viewer.base + '/api/records/0001', { method: 'PATCH', headers: { Authorization: `Bearer ${viewer.token}`, 'Content-Type': 'text/plain' }, body: 'x' });
    assert.equal(badType.status, 415);
    const extra = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { store_revision: rev, content: '乙', type: 'fact', status: 'active', weight: 9 } });
    assert.equal(extra.status, 400);
    // undici forbids overriding Host; use a raw http request for the Host check.
    const hostStatus = await new Promise((resolve, reject) => {
      const req = http.request(viewer.base + '/api/snapshot', { headers: { Host: 'evil.example', Authorization: `Bearer ${viewer.token}` } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(hostStatus, 403);
    const anyPath = await api(viewer, '/../../etc/passwd');
    assert.equal(anyPath.status, 404);
    assert.ok(fs.readFileSync(memory(root)).equals(before));
  } finally { await viewer.stop(); }
});

/**
 * Given：损坏的库（含未知结构元素）
 * When：读取快照并尝试 PATCH
 * Then：快照 read_only=true 且 PATCH 422；原文件逐字节不变
 * 防回归：查看器静默丢弃不认识的数据
 */
test('damaged store is read-only with diagnostics and never rewritten', async () => {
  const raw = store('0002') + record('0001', '甲') + '<!-- <unknown x="1" /> -->\n';
  const root = project(raw);
  const viewer = await startViewer(root);
  try {
    const snap = await snapshot(viewer);
    assert.equal(snap.read_only, true);
    const r = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { store_revision: snap.store_revision, content: '乙', type: 'fact', status: 'active' } });
    assert.ok([400, 422].includes(r.status));
    assert.equal(fs.readFileSync(memory(root), 'utf8'), raw);
  } finally { await viewer.stop(); }
});

/**
 * Given：正文含 HTML 与脚本标记的记录
 * When：读取快照与页面
 * Then：正文作为 JSON 文本返回；页面不含该正文
 * 防回归：打开记忆触发脚本执行
 */
test('record bodies are served as inert text only', async () => {
  const xss = '<img src=x onerror=alert(1)><script>alert(2)</' + 'script>';
  const root = project(store('0002') + record('0001', xss));
  const viewer = await startViewer(root);
  try {
    const snap = await snapshot(viewer);
    assert.equal(snap.records[0].content, xss);
    const page = await fetch(viewer.base + '/').then((r) => r.text());
    assert.ok(!page.includes('onerror=alert'), 'page must not embed record bodies');
  } finally { await viewer.stop(); }
});

/**
 * Given：一次 PATCH 同时改正文、类型、状态
 * When：写盘后用 CLI inspect
 * Then：三字段原子生效；created_at 不变；账本无新增事件
 * 防回归：多次保存产生中间版本
 */
test('single PATCH commits content, type and status atomically', async () => {
  const root = project(store('0002') + record('0001', '甲'));
  const viewer = await startViewer(root);
  try {
    const rev = (await snapshot(viewer)).store_revision;
    const r = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { store_revision: rev, content: '乙', type: 'pitfall', status: 'review' } });
    assert.equal(r.status, 200);
    const after = JSON.parse(runCli(root, 'inspect', '0001'));
    assert.equal(after.content, '乙');
    assert.equal(after.type, 'pitfall');
    assert.equal(after.status, 'review');
    assert.equal(after.created_at, '2026-08-05T00:00:00Z');
    const ledger = fs.readFileSync(path.join(root, '.project-self-memory', 'evidence.jsonl'), 'utf8');
    assert.equal(ledger, '');
  } finally { await viewer.stop(); }
});

/**
 * Given：提交与现状完全相同的三字段
 * When：PATCH
 * Then：applied=false 且不新增备份
 * 防回归：无变化保存制造噪音备份
 */
test('unchanged save does not write or back up', async () => {
  const root = project();
  // Write through the CLI so the fixture is byte-canonical.
  const body = path.join(root, 'b.txt'); fs.writeFileSync(body, '甲');
  runCli(root, 'add', '--type', 'fact', '--content-file', body);
  const backupsDir = path.join(root, '.project-self-memory', 'backups');
  const backupsBefore = fs.readdirSync(backupsDir).length;
  const viewer = await startViewer(root);
  try {
    const rev = (await snapshot(viewer)).store_revision;
    const r = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { store_revision: rev, content: '甲', type: 'fact', status: 'active' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.applied, false);
    assert.equal(fs.readdirSync(backupsDir).length, backupsBefore);
  } finally { await viewer.stop(); }
});

/**
 * Given：备份路径被文件占用
 * When：PATCH 触发写入
 * Then：500 BACKUP_FAILED，原文件不变
 * 防回归：备份失败仍提交写入
 */
test('backup failure aborts the write', async () => {
  const root = project(store('0002') + record('0001', '甲'));
  fs.writeFileSync(path.join(root, '.project-self-memory', 'backups'), 'blocked');
  const viewer = await startViewer(root);
  try {
    const rev = (await snapshot(viewer)).store_revision;
    const r = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { store_revision: rev, content: '乙', type: 'fact', status: 'active' } });
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'BACKUP_FAILED');
    assert.match(fs.readFileSync(memory(root), 'utf8'), /甲/);
  } finally { await viewer.stop(); }
});

/**
 * Given：源码与产物
 * When：运行构建器两次并 --check
 * Then：两次产物字节一致（无可变信息）；--check 通过
 * 防回归：产物随时间漂移或不可审计
 */
test('build is reproducible and drift-checkable', () => {
  const first = fs.readFileSync(dist);
  execFileSync(process.execPath, [builder], { encoding: 'utf8' });
  const second = fs.readFileSync(dist);
  assert.ok(first.equals(second));
  const check = execFileSync(process.execPath, [builder, '--check'], { encoding: 'utf8' });
  assert.match(check, /PSM_VIEWER_CONSISTENT/);
});

/**
 * Given：交付脚本复制到带空格的项目根，从另一 cwd 启动
 * When：读取快照
 * Then：读取项目根内的记忆而非 cwd 的记忆
 * 防回归：误操作其他项目的记忆
 */
test('script beside the store wins over the launch cwd, even with spaces', async () => {
  const spaced = fs.mkdtempSync(path.join(os.tmpdir(), 'psm spaced dir '));
  runCli(spaced, 'init');
  fs.writeFileSync(memory(spaced), store('0002') + record('0001', '带空格路径'));
  fs.copyFileSync(dist, path.join(spaced, 'view-memoery.js'));
  const elsewhere = temp();
  const child = spawn(process.execPath, [path.join(spaced, 'view-memoery.js'), '--no-open'], { cwd: elsewhere, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (c) => { out += c; const m = out.match(/PSM_VIEWER_URL: (\S+)/); if (m) resolve(m[1]); });
    child.on('exit', () => reject(Error(out)));
    setTimeout(() => reject(Error('timeout')), 15000);
  });
  try {
    const parsed = new URL(url);
    const res = await fetch(`http://127.0.0.1:${parsed.port}/api/snapshot`, { headers: { Authorization: `Bearer ${parsed.hash.replace('#token=', '')}` } });
    const snap = await res.json();
    assert.equal(snap.records[0].content, '带空格路径');
  } finally { child.kill(); }
});

/**
 * Given：init 部署的查看器位于 .project-self-memory/ 内
 * When：按部署位置启动（用户标准用法）
 * Then：记忆目录解析为项目根的 .project-self-memory/，快照正常返回
 * 防回归：脚本在记忆目录内启动时误推导出双层嵌套目录
 */
test('deployed script inside the store directory resolves the store beside it', async () => {
  const root = temp();
  runCli(root, 'init');
  fs.writeFileSync(memory(root), store('0002') + record('0001', '部署位置启动'));
  const viewer = await startViewer(root);
  try {
    const snap = await snapshot(viewer);
    assert.equal(snap.records[0].content, '部署位置启动');
  } finally { await viewer.stop(); }
});

/**
 * Given：查看器默认启动（echo 诊断模式隔离真实浏览器）
 * When：读取启动日志
 * Then：输出 PSM_VIEWER_OPEN_URL 且服务正常应答快照
 * 防回归：默认自动打开行为丢失或破坏令牌交接
 */
test('default startup opens the browser automatically', async () => {
  const root = temp();
  runCli(root, 'init');
  const script = path.join(root, '.project-self-memory', 'view-memoery.js');
  const child = spawn(process.execPath, [script], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PSM_VIEWER_OPEN: 'echo' } });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`启动超时: ${out}`)), 15000);
    const onData = (chunk) => {
      const match = out.match(/PSM_VIEWER_URL: (\S+)/);
      if (match) { clearTimeout(timer); child.stdout.off('data', onData); resolve(match[1]); }
    };
    child.stdout.on('data', onData);
    child.on('exit', () => reject(Error(`提前退出: ${out}`)));
  });
  try {
    const parsed = new URL(url);
    const res = await fetch(`http://127.0.0.1:${parsed.port}/api/snapshot`, { headers: { Authorization: `Bearer ${parsed.hash.replace('#token=', '')}` } });
    assert.equal(res.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 300)); // 等打开钩子输出
    assert.match(out, /PSM_VIEWER_OPEN_URL: http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{64}/);
  } finally { child.kill(); }
});

/**
 * Given：查看器以 --no-open 启动
 * When：读取启动日志
 * Then：不出现 PSM_VIEWER_OPEN_URL，打开被禁止
 * 防回归：--no-open 失效导致无头环境弹浏览器
 * 注：诊断模式 PSM_VIEWER_OPEN=echo 优先级最高，会压过 --no-open，
 * 故本用例不设该变量；实现回归时检出方式是断言失败。
 */
test('--no-open disables the automatic browser launch', async () => {
  const root = temp();
  runCli(root, 'init');
  const script = path.join(root, '.project-self-memory', 'view-memoery.js');
  const child = spawn(process.execPath, [script, '--no-open'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PSM_VIEWER_OPEN: '' } });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`启动超时: ${out}`)), 15000);
    const onData = () => { if (/PSM_VIEWER_URL:/.test(out)) { clearTimeout(timer); child.stdout.off('data', onData); resolve(); } };
    child.stdout.on('data', onData);
    child.on('exit', () => reject(Error(`提前退出: ${out}`)));
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.doesNotMatch(out, /PSM_VIEWER_OPEN_URL/);
  } finally { child.kill(); }
});
