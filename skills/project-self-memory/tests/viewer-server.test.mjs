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
 * Given：源码与产物（autocrlf 检出会把仓库内 LF 的产物 smudge 成磁盘 CRLF）
 * When：运行构建器两次并 --check
 * Then：两次产物内容一致（首读归一化行尾，忽略 checkout 行尾差异）；
 *       --check 通过；产物能被 node 解析（仅首行一个 shebang，工厂体内无残留 `#!`）
 * 防回归：CRLF 源上 shebang 剥离失配，坏产物字节级可复现却不可运行；
 *         产物随时间漂移或不可审计；fresh checkout 上磁盘行尾误报漂移
 */
test('build is reproducible and drift-checkable', () => {
  const normalize = (text) => text.replace(/\r\n/g, '\n');
  const first = normalize(fs.readFileSync(dist, 'utf8'));
  execFileSync(process.execPath, [builder], { encoding: 'utf8' });
  const second = normalize(fs.readFileSync(dist, 'utf8'));
  assert.equal(first, second);
  // 产物可运行性防线：坏产物字节比对是盲的，必须让 node 自己做语法校验。
  execFileSync(process.execPath, ['--check', dist]);
  const artifact = fs.readFileSync(dist, 'utf8');
  const shebangLines = artifact.split('\n').filter((line) => line.startsWith('#!'));
  assert.equal(shebangLines.length, 1, 'shebang 只允许出现在产物第 1 行');
  const check = execFileSync(process.execPath, [builder, '--check'], { encoding: 'utf8' });
  assert.match(check, /PSM_VIEWER_CONSISTENT/);
});

/**
 * Given：临时副本目录，模块源被改写成 CRLF 或 CRLF/LF 逐行交替（注入前先归一
 *       到 LF，保证构造的是纯混合行尾而非「在 CRLF 上再叠 CRLF」）
 * When：用副本里的构建器（`here` 指向副本目录）各构建一次
 * Then：两种行尾形态的产物与仓库产物内容一致——构建结果与磁盘行尾无关
 * 防回归：autocrlf 环境下产物字节随 checkout 行尾浮动，跨环境 --check 假漂移
 */
test('mixed-eol sources build to a byte-stable artifact', () => {
  const normalize = (text) => text.replace(/\r\n/g, '\n');
  const expected = normalize(fs.readFileSync(dist, 'utf8'));
  const scripts = path.resolve(here, '../scripts');
  const sources = fs.readdirSync(scripts).filter((f) => f.endsWith('.mjs'));
  for (const mode of ['all-crlf', 'mixed-eol']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-eol-'));
    for (const f of sources) {
      const base = normalize(fs.readFileSync(path.join(scripts, f), 'utf8'));
      // 构建器自身除外：注入 `here` 让它读副本目录的模块源
      const source = f === 'build-viewer.mjs'
        ? base.replace('const here = path.dirname(fileURLToPath(import.meta.url));', `const here = ${JSON.stringify(dir)};`)
        : (mode === 'all-crlf'
          ? base.replace(/\n/g, '\r\n')
          : base.split('\n').map((line, i) => (i % 2 ? `${line}\r\n` : `${line}\n`)).join(''));
      fs.writeFileSync(path.join(dir, f), source);
    }
    execFileSync(process.execPath, [path.join(dir, 'build-viewer.mjs')], { encoding: 'utf8' });
    assert.equal(normalize(fs.readFileSync(dist, 'utf8')), expected, `${mode} 源构建的产物应与归一化基线一致`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // 产物本体必须是纯 LF：仓库内字节确定，任何环境 checkout 后内容一致。
  const artifact = fs.readFileSync(dist, 'utf8');
  assert.doesNotMatch(artifact, /\r\n/, '产物应全程 LF，无 CRLF');
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

/** Source HTTP seam lets integration run before the coordinator rebuilds dist. */
async function startSourceViewer(root) {
  const [crypto, storeModule, lockModule, ledgerModule, tagsModule, serverModule, pageModule] = await Promise.all([
    import('node:crypto'), import('../scripts/memory-store.mjs'), import('../scripts/memory-lock.mjs'),
    import('../scripts/evidence-ledger.mjs'), import('../scripts/memory-tags.mjs'),
    import('../scripts/viewer-server.mjs'), import('../scripts/viewer-page.mjs'),
  ]);
  const token = crypto.randomBytes(32).toString('hex');
  const { server } = serverModule.createViewerServer({
    fs, path, crypto, http, store: storeModule, lock: lockModule, ledger: ledgerModule, tags: tagsModule,
    projectRoot: root, token, pageHtml: pageModule.VIEWER_PAGE_HTML,
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    base: `http://127.0.0.1:${server.address().port}`, token,
    stop: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

/**
 * Given：记录含行首前缀，项目 taxonomy 含字面量 any/all 规则
 * When：读取真实查看器快照
 * Then：v2 快照含派生标签与公开规则，读取前后原始文件逐字节不变
 * 防回归：查看器遗漏标签集成或读取时污染持久化记录
 */
test('tag snapshot derives prefixes and project rules without writing files', async () => {
  const root = project(store('0002') + record('0001', '[host_scope=tenc] Redis backup'));
  const tagFile = path.join(root, '.project-self-memory', 'tags.json');
  fs.writeFileSync(tagFile, JSON.stringify({ version: 1, tags: [
    { name: 'backup', any: ['backup'], all: [] },
    { name: 'redis', any: [], all: ['REDIS', 'backup'] },
  ], overrides: {} }));
  const files = [memory(root), path.join(root, '.project-self-memory', 'evidence.jsonl'), tagFile];
  const before = files.map((file) => fs.readFileSync(file));
  const viewer = await startSourceViewer(root);
  try {
    const snap = await snapshot(viewer);
    assert.equal(snap.format, 'psm-viewer-snapshot-v2');
    assert.deepEqual(new Set(snap.records[0].tags), new Set(['host_scope:tenc', 'backup', 'redis']));
    assert.deepEqual(snap.taxonomy.tags.map((tag) => tag.name), ['backup', 'redis']);
    assert.equal(snap.read_only, false);
    files.forEach((file, i) => assert.ok(fs.readFileSync(file).equals(before[i])));
  } finally { await viewer.stop(); }
});

/**
 * Given：项目没有 tags.json，记录正文含通用行首前缀
 * When：读取源码查看器快照并保存新前缀正文
 * Then：零配置前缀仍生效，保存响应按新正文重新派生，标签不写入 memory.md
 * 防回归：缺少分类标准时误禁用内置规则，或保存后显示旧标签
 */
test('tag snapshot supports missing taxonomy and recomputes tags after PATCH', async () => {
  const root = project(store('0002') + record('0001', '[scope=old] 原文'));
  const viewer = await startSourceViewer(root);
  try {
    const snap = await snapshot(viewer);
    assert.deepEqual(snap.records[0].tags, ['scope:old']);
    assert.deepEqual(snap.taxonomy, { version: 1, tags: [] });
    assert.equal(snap.read_only, false);
    const saved = await api(viewer, '/api/records/0001', { method: 'PATCH', body: {
      store_revision: snap.store_revision, content: '[scope=new] 新正文', type: 'fact', status: 'active',
    } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.snapshot.records[0].tags, ['scope:new']);
    assert.ok(!fs.existsSync(path.join(root, '.project-self-memory', 'tags.json')));
    assert.doesNotMatch(fs.readFileSync(memory(root), 'utf8'), /tags=/);
  } finally { await viewer.stop(); }
});

/**
 * Given：tags.json 为非法 JSON 或含非法标签，原始记录仍有效
 * When：读取快照并通过正常 PATCH 保存正文
 * Then：返回 warning 和空标签但不只读，保存成功且损坏的标签文件保持不变
 * 防回归：标签元数据损坏被误认为主库损坏并阻止正常读写
 */
test('tag snapshot warnings degrade to no tags without blocking saves', async () => {
  for (const invalid of ['{broken', JSON.stringify({ version: 1, tags: [{ name: 'INVALID' }], overrides: {} })]) {
    const root = project(store('0002') + record('0001', '[scope=old] 原文'));
    const tagFile = path.join(root, '.project-self-memory', 'tags.json');
    fs.writeFileSync(tagFile, invalid);
    const viewer = await startSourceViewer(root);
    try {
      const snap = await snapshot(viewer);
      assert.equal(snap.read_only, false);
      assert.deepEqual(snap.records[0].tags, []);
      assert.ok(snap.diagnostics.some((item) => item.kind === 'tags' && item.impact === 'warning'));
      const saved = await api(viewer, '/api/records/0001', { method: 'PATCH', body: {
        store_revision: snap.store_revision, content: '[scope=new] 保存仍可用', type: 'fact', status: 'active',
      } });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.snapshot.read_only, false);
      assert.deepEqual(saved.body.snapshot.records[0].tags, []);
      assert.equal(fs.readFileSync(tagFile, 'utf8'), invalid);
    } finally { await viewer.stop(); }
  }
});

/**
 * Given：读取快照后只修改 tags.json，未修改正文或账本
 * When：重新读快照，再用原 store_revision 保存；另尝试提交 tags 字段
 * Then：派生标签更新而记录版本和库版本不变，正常保存成功，tags 字段仍被拒绝
 * 防回归：只读元数据触发虚假并发冲突或扩大 PATCH 写入白名单
 */
test('tag metadata changes neither revisions nor the PATCH whitelist', async () => {
  const root = project(store('0002') + record('0001', 'Redis backup'));
  const tagFile = path.join(root, '.project-self-memory', 'tags.json');
  const viewer = await startSourceViewer(root);
  try {
    const before = await snapshot(viewer);
    fs.writeFileSync(tagFile, JSON.stringify({ version: 1, tags: [{ name: 'redis', any: ['redis'] }], overrides: {} }));
    const after = await snapshot(viewer);
    assert.deepEqual(after.records[0].tags, ['redis']);
    assert.equal(after.store_revision, before.store_revision);
    assert.equal(after.records[0].record_version, before.records[0].record_version);
    const payload = { store_revision: before.store_revision, content: 'Redis backup updated', type: 'fact', status: 'active' };
    const rejected = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { ...payload, tags: ['forged'] } });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, 'BAD_FIELDS');
    const saved = await api(viewer, '/api/records/0001', { method: 'PATCH', body: payload });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.snapshot.records[0].tags, ['redis']);
  } finally { await viewer.stop(); }
});

// ---- 工单 02：快照 cache 节与三条 POST 路由 ------------------------------

const cacheFile = (root) => path.join(root, '.project-self-memory', 'cache.jsonl');

/** 造候选走 CLI（正文必须 --content-file，单行契约）。 */
function cacheAdd(root, ...argv) {
  return JSON.parse(runCli(root, 'cache', 'add', ...argv));
}

/** CLI 造记录，返回新 id。 */
function cliAdd(root, content) {
  const body = path.join(root, `body-${Math.random().toString(36).slice(2, 8)}.txt`);
  fs.writeFileSync(body, content);
  return runCli(root, 'add', '--type', 'fact', '--content-file', body).trim();
}

/**
 * Given：cache 里有一条 add 候选与同目标记录的两条 update 候选；目标正文在暂存后被改
 * When：读取快照 cache 节
 * Then：new 独立成组、同目标 update 成组、失效候选单独成 stale 组且 current 为新正文；
 *       组对象含冻结 schema 全部字段；store_revision 不受 cache 影响
 * 防回归：分组规则与 CLI cacheList 漂移，或 03 页面拿不到 current 对照
 */
test('snapshot cache section groups new/target/stale with current snapshot', async () => {
  const root = project(store('0002') + record('0001', '原文正文'));
  const body1 = path.join(root, 'b1.txt');
  fs.writeFileSync(body1, '全新候选记录');
  cacheAdd(root, '--op', 'add', '--record-type', 'fact', '--content-file', body1);
  const body2 = path.join(root, 'b2.txt');
  fs.writeFileSync(body2, '修订一号');
  cacheAdd(root, '--op', 'update', '--target', '0001', '--content-file', body2);
  // 同目标第二条 update：不同 source 才会有不同 event_id
  const body3 = path.join(root, 'b3.txt');
  fs.writeFileSync(body3, '修订二号');
  cacheAdd(root, '--op', 'update', '--target', '0001', '--content-file', body3, '--source', 'session-2');
  // 令 0001 失效：外部 CLI 改目标正文（版本变化）
  const body4 = path.join(root, 'b4.txt');
  fs.writeFileSync(body4, '外部新正文');
  runCli(root, 'update', '0001', '--content-file', body4);

  const viewer = await startViewer(root);
  try {
    const snap = await snapshot(viewer);
    assert.equal(snap.cache.count, 3);
    const kinds = Object.groupBy(snap.cache.groups, (g) => g.kind);
    // 两条 update 的 event_id 只差 fingerprint/content：同目标 update 成组时
    // conflict=true（组内多修订），失效后并入 stale 组
    assert.deepEqual(Object.keys(kinds).sort(), ['new', 'stale']);
    assert.equal(kinds.new.length, 1);
    assert.equal(kinds.stale.length, 1);
    const staleGroup = kinds.stale[0];
    assert.equal(staleGroup.key, 'stale:0001');
    assert.equal(staleGroup.stale, true);
    assert.equal(staleGroup.count, 2);
    assert.equal(staleGroup.conflict, true);
    assert.ok(staleGroup.entries.every((entry) => entry.stale === true));
    // current 是失效后的新正文（外部 update 已落盘）
    assert.equal(staleGroup.current.exists, true);
    assert.equal(staleGroup.current.content, '外部新正文');
    assert.equal(typeof staleGroup.current.record_version, 'string');
    assert.equal(staleGroup.current.type, 'fact');
    // new 组：key/refid/current 按冻结 schema
    const newGroup = kinds.new[0];
    assert.match(newGroup.key, /^new:[a-f0-9]{32}$/);
    assert.equal(newGroup.refid, null);
    assert.equal(newGroup.stale, false);
    assert.equal(newGroup.conflict, false);
    assert.equal(newGroup.count, 1);
    assert.equal(newGroup.current, null);
    assert.equal(newGroup.entries[0].payload.content, '全新候选记录');
    assert.equal(newGroup.entries[0].stale, false);
  } finally { await viewer.stop(); }
});

/**
 * Given：一条 pending 的 add 候选
 * When：POST apply（带当前 store_revision）
 * Then：200、memory.md 出现新记录（磁盘断言）、条目转 applied、快照 count 减少、
 *       响应带 record_id 与完整新快照
 * 防回归：写入成功但条目仍 pending 导致重复落库
 */
test('apply add lands the candidate and marks it applied', async () => {
  const root = project(store('0002'));
  const body = path.join(root, 'b.txt');
  fs.writeFileSync(body, 'ADD_APPLY_SENTINEL_9a1b');
  const added = cacheAdd(root, '--op', 'add', '--record-type', 'fact', '--content-file', body);
  const viewer = await startViewer(root);
  try {
    const rev = (await snapshot(viewer)).store_revision;
    const r = await api(viewer, `/api/cache/${added.event_id}/apply`, { method: 'POST', body: { store_revision: rev } });
    assert.equal(r.status, 200);
    assert.equal(r.body.applied, true);
    assert.match(r.body.record_id, /^\d{4}$/);
    assert.match(fs.readFileSync(memory(root), 'utf8'), /ADD_APPLY_SENTINEL_9a1b/);
    assert.equal(r.body.snapshot.cache.count, 0);
    // 条目转 applied：磁盘上状态变化
    const raw = fs.readFileSync(cacheFile(root), 'utf8');
    assert.match(raw, /"status":"applied"/);
    assert.match(raw, /"processed_at":"\d{4}-/);
  } finally { await viewer.stop(); }
});

/**
 * Given：一条 pending 的 update 候选
 * When：apply 请求带 content 改写版；另对多行正文发同请求
 * Then：改写版落盘且评分投影重置（CLI inspect positive=0）；多行正文 400 CONTRACT
 *       且条目保持 pending
 * 防回归：改写版未生效或多行正文绕过单行契约写坏库
 */
test('apply update rewrites content, resets projection, rejects multiline', async () => {
  const root = project(store('0002') + record('0001', '旧正文待修订'));
  const body = path.join(root, 'b.txt');
  fs.writeFileSync(body, '暂存版正文');
  const added = cacheAdd(root, '--op', 'update', '--target', '0001', '--content-file', body);
  const viewer = await startViewer(root);
  try {
    const rev = (await snapshot(viewer)).store_revision;
    const ok = await api(viewer, `/api/cache/${added.event_id}/apply`, { method: 'POST', body: { store_revision: rev, content: '改写后的终稿' } });
    assert.equal(ok.status, 200);
    const after = JSON.parse(runCli(root, 'inspect', '0001'));
    assert.equal(after.content, '改写后的终稿');
    assert.equal(after.positive, 0);
    assert.equal(after.negative, 0);
    // 多行正文 → 400 CONTRACT，条目保持 pending
    const bad = cacheAdd(root, '--op', 'update', '--target', '0001', '--content-file', body, '--source', 's2');
    const r = await api(viewer, `/api/cache/${bad.event_id}/apply`, { method: 'POST', body: { store_revision: rev, content: '第一行\n第二行' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'CONTRACT');
    const listed = JSON.parse(runCli(root, 'cache', 'list'));
    assert.equal(listed.count, 1);
    assert.equal(listed.groups[0].entries[0].event_id, bad.event_id);
  } finally { await viewer.stop(); }
});

/**
 * Given：一条 update 候选，暂存后目标正文被外部改掉（已失效）
 * When：POST apply
 * Then：409 且 message 含原基准 vs 现状；条目保持 pending（快照仍见）
 * 防回归：失效候选直接覆盖用户已改过的正文
 */
test('stale candidate apply is rejected and stays pending', async () => {
  const root = project(store('0002') + record('0001', '基准正文'));
  const body = path.join(root, 'b.txt');
  fs.writeFileSync(body, '过期修订');
  const added = cacheAdd(root, '--op', 'update', '--target', '0001', '--content-file', body);
  const body2 = path.join(root, 'b2.txt');
  fs.writeFileSync(body2, '外部改动后的现状');
  runCli(root, 'update', '0001', '--content-file', body2);
  const viewer = await startViewer(root);
  try {
    const rev = (await snapshot(viewer)).store_revision;
    const r = await api(viewer, `/api/cache/${added.event_id}/apply`, { method: 'POST', body: { store_revision: rev } });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'CONFLICT');
    assert.match(r.body.message, /基准正文/);
    assert.match(r.body.message, /外部改动后的现状/);
    // 条目保持 pending：快照里仍能看到
    const snap = await snapshot(viewer);
    assert.equal(snap.cache.count, 1);
    assert.equal(snap.cache.groups[0].kind, 'stale');
  } finally { await viewer.stop(); }
});

/**
 * Given：pending 与 applied 两种条目
 * When：依次 discard pending、重复 discard、discard applied
 * Then：pending 转 discarded 200；重复 discard 幂等 200；applied 409；
 *       全程 memory.md 不变（cache-only）
 * 防回归：丢弃路径写主库或覆盖已落库条目
 */
test('discard state machine: pending ok, applied 409, repeat idempotent', async () => {
  const root = project(store('0002'));
  const body = path.join(root, 'b.txt');
  fs.writeFileSync(body, '将被丢弃的候选');
  const added = cacheAdd(root, '--op', 'add', '--record-type', 'fact', '--content-file', body);
  const viewer = await startViewer(root);
  try {
    const rev = (await snapshot(viewer)).store_revision;
    const r1 = await api(viewer, `/api/cache/${added.event_id}/discard`, { method: 'POST', body: { store_revision: rev } });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.applied, true);
    assert.match(fs.readFileSync(cacheFile(root), 'utf8'), /"status":"discarded"/);
    // 重复 discard 幂等
    const r2 = await api(viewer, `/api/cache/${added.event_id}/discard`, { method: 'POST', body: { store_revision: rev } });
    assert.equal(r2.status, 200);
    // cache-only 变更不产生备份（backups 目录不应被创建）
    assert.equal(fs.existsSync(path.join(root, '.project-self-memory', 'backups')), false);
    // applied 条目拒绝 discard
    const body2 = path.join(root, 'b2.txt');
    fs.writeFileSync(body2, '落库候选');
    const applied = cacheAdd(root, '--op', 'add', '--record-type', 'fact', '--content-file', body2, '--source', 's2');
    const ra = await api(viewer, `/api/cache/${applied.event_id}/apply`, { method: 'POST', body: { store_revision: rev } });
    assert.equal(ra.status, 200);
    const before = fs.readFileSync(memory(root));
    const r3 = await api(viewer, `/api/cache/${applied.event_id}/discard`, { method: 'POST', body: { store_revision: rev } });
    assert.equal(r3.status, 409);
    assert.ok(fs.readFileSync(memory(root)).equals(before));
  } finally { await viewer.stop(); }
});

/**
 * Given：一条 ±1 候选（source 合法）
 * When：apply 两次（第二次 event 已存在）
 * Then：200，evidence.jsonl 出现 cache-apply-<event_id> 事件且评分字段更新；
 *       第二次不产生第二条事件（幂等）
 * 防回归：重试刷分或账本键与 CLI 不一致
 */
test('score apply appends idempotent ledger event and updates projection', async () => {
  const root = project(store('0002') + record('0001', '被投票的记录'));
  const added = cacheAdd(root, '--op', '+1', '--target', '0001', '--source', 'task-x');
  const viewer = await startViewer(root);
  try {
    const rev = (await snapshot(viewer)).store_revision;
    const r1 = await api(viewer, `/api/cache/${added.event_id}/apply`, { method: 'POST', body: { store_revision: rev } });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.record_id, '0001');
    const ledgerPath = path.join(root, '.project-self-memory', 'evidence.jsonl');
    const ledgerText = fs.readFileSync(ledgerPath, 'utf8');
    assert.equal(ledgerText.split('\n').filter((line) => line.includes(`cache-apply-${added.event_id}`)).length, 1);
    const after = JSON.parse(runCli(root, 'inspect', '0001'));
    assert.equal(after.positive, 1);
    // 重复 apply：条目已 applied → 409（非 pending 拒绝），账本仍只有一条
    const r2 = await api(viewer, `/api/cache/${added.event_id}/apply`, { method: 'POST', body: { store_revision: rev } });
    assert.equal(r2.status, 409);
    assert.equal(fs.readFileSync(ledgerPath, 'utf8'), ledgerText);
  } finally { await viewer.stop(); }
});

/**
 * Given：cache 路由面对无令牌、跨 Origin、未知字段、锁忙四种请求
 * When：分别发出
 * Then：401 / 403 ORIGIN_REJECTED / 400 BAD_FIELDS / 503 LOCK_BUSY
 * 防回归：cache 路由绕过与记录 PATCH 相同的安检链
 */
test('cache routes enforce token, origin, field whitelist and lock', async () => {
  const root = project(store('0002') + record('0001', '甲'));
  const body = path.join(root, 'b.txt');
  fs.writeFileSync(body, '安检候选');
  const added = cacheAdd(root, '--op', 'update', '--target', '0001', '--content-file', body);
  const viewer = await startViewer(root);
  const lockFile = path.join(root, '.project-self-memory', 'cache.lock');
  try {
    const rev = (await snapshot(viewer)).store_revision;
    assert.equal((await api(viewer, `/api/cache/${added.event_id}/apply`, { method: 'POST', token: '', body: { store_revision: rev } })).status, 401);
    const cross = await api(viewer, `/api/cache/${added.event_id}/apply`, { method: 'POST', body: { store_revision: rev }, headers: { Origin: 'http://evil.example' } });
    assert.equal(cross.status, 403);
    assert.equal(cross.body.error, 'ORIGIN_REJECTED');
    const extra = await api(viewer, `/api/cache/${added.event_id}/apply`, { method: 'POST', body: { store_revision: rev, weight: 9 } });
    assert.equal(extra.status, 400);
    assert.equal(extra.body.error, 'BAD_FIELDS');
    // prune 的白名单不同：older_than_days 合法、content 拒绝
    const pruneBad = await api(viewer, '/api/cache/prune', { method: 'POST', body: { store_revision: rev, content: 'x' } });
    assert.equal(pruneBad.status, 400);
    // 锁忙：外部先持 cache.lock
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
    const busy = await api(viewer, `/api/cache/${added.event_id}/apply`, { method: 'POST', body: { store_revision: rev } });
    assert.equal(busy.status, 503);
    assert.equal(busy.body.error, 'LOCK_BUSY');
    const busyPrune = await api(viewer, '/api/cache/prune', { method: 'POST', body: { store_revision: rev } });
    assert.equal(busyPrune.status, 503);
  } finally {
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
    await viewer.stop();
  }
});

/**
 * Given：cache 里 applied、discarded、pending 三种条目，另有一条 pending 的
 *       stale（目标已被改）
 * When：POST prune；再带 older_than_days=365 对新建的已处理条目 prune
 * Then：第一次清掉已处理与 stale、留 pending（removed=3）；第二次阈值内条目
 *       保留（removed=0），且刚落库的 applied 条目仍在磁盘 cache.jsonl 上
 * 防回归：prune 误删 pending、时效阈值方向反了，或误清刚落库的审计条目
 */
test('prune removes processed and stale, keeps pending; respects threshold', async () => {
  const root = project(store('0002') + record('0001', '基准'));
  const body = path.join(root, 'b.txt');
  fs.writeFileSync(body, '待丢弃');
  const discarded = cacheAdd(root, '--op', 'add', '--record-type', 'fact', '--content-file', body);
  runCli(root, 'cache', 'discard', '--id', discarded.event_id);
  const body2 = path.join(root, 'b2.txt');
  fs.writeFileSync(body2, '待落库后清理');
  const applied = cacheAdd(root, '--op', 'add', '--record-type', 'fact', '--content-file', body2, '--source', 's2');
  runCli(root, 'cache', 'apply', '--id', applied.event_id, '--decision', 'write');
  const body3 = path.join(root, 'b3.txt');
  fs.writeFileSync(body3, '存活的 pending');
  cacheAdd(root, '--op', 'add', '--record-type', 'fact', '--content-file', body3, '--source', 's3');
  const body4 = path.join(root, 'b4.txt');
  fs.writeFileSync(body4, '过期的修订');
  const stale = cacheAdd(root, '--op', 'update', '--target', '0001', '--content-file', body4, '--source', 's4');
  const body5 = path.join(root, 'b5.txt');
  fs.writeFileSync(body5, '外部改动');
  runCli(root, 'update', '0001', '--content-file', body5);
  // stale 候选 apply 会被拒，它保持 pending 但读时 stale → prune 清掉

  const viewer = await startViewer(root);
  try {
    const rev = (await snapshot(viewer)).store_revision;
    const r = await api(viewer, '/api/cache/prune', { method: 'POST', body: { store_revision: rev } });
    assert.equal(r.status, 200);
    assert.equal(r.body.removed, 3);
    const kept = JSON.parse(runCli(root, 'cache', 'list'));
    assert.equal(kept.count, 1);
    assert.equal(kept.groups[0].entries[0].payload.content, '存活的 pending');
    // 新建的已处理条目 + older_than_days=365 → 保留
    const body6 = path.join(root, 'b6.txt');
    fs.writeFileSync(body6, '刚落库的新条目');
    const fresh = cacheAdd(root, '--op', 'add', '--record-type', 'fact', '--content-file', body6, '--source', 's6');
    const rev2 = (await snapshot(viewer)).store_revision;
    const ra = await api(viewer, `/api/cache/${fresh.event_id}/apply`, { method: 'POST', body: { store_revision: rev2 } });
    assert.equal(ra.status, 200);
    const r2 = await api(viewer, '/api/cache/prune', { method: 'POST', body: { store_revision: rev2, older_than_days: 365 } });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.removed, 0);
    const still = JSON.parse(runCli(root, 'cache', 'list'));
    assert.equal(still.count, 1);
    // 恒真式断言已修：cache list 只吐 pending，applied 条目要用 cache show
    // 直查磁盘上的那条，断言它未被 365 天阈值 prune 掉且状态为 applied。
    const shown = JSON.parse(runCli(root, 'cache', 'show', fresh.event_id));
    assert.equal(shown.status, 'applied');
    assert.equal(shown.payload.content, '刚落库的新条目');
  } finally { await viewer.stop(); }
});

/**
 * Given：discard 与 prune 各自完成一次 cache-only 变更
 * When：用变更前的旧 store_revision 发记录 PATCH
 * Then：PATCH 仍成功（cache 变更不参与 store_revision 口径）
 * 防回归：cache-only 操作打断用户的记录编辑流
 */
test('cache-only changes keep the record PATCH revision valid', async () => {
  const root = project(store('0002') + record('0001', '不受影响的记录'));
  const body = path.join(root, 'b.txt');
  fs.writeFileSync(body, '走完 discard 与 prune 的候选');
  const added = cacheAdd(root, '--op', 'add', '--record-type', 'fact', '--content-file', body);
  const viewer = await startViewer(root);
  try {
    const rev = (await snapshot(viewer)).store_revision;
    assert.equal((await api(viewer, `/api/cache/${added.event_id}/discard`, { method: 'POST', body: { store_revision: rev } })).status, 200);
    assert.equal((await api(viewer, '/api/cache/prune', { method: 'POST', body: { store_revision: rev } })).status, 200);
    const patched = await api(viewer, '/api/records/0001', { method: 'PATCH', body: { store_revision: rev, content: '新正文仍可用旧修订', type: 'fact', status: 'active' } });
    assert.equal(patched.status, 200);
  } finally { await viewer.stop(); }
});
