import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const distribution = path.resolve(here, '../runtime-dist/psm-cli.js');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psm-bundle-'));
const record = (id, content, status = 'active') => `<!-- <psm id="${id}" type="fact" status="${status}" positive="0" negative="0" created_at="2026-08-05T00:00:00Z" last_scored_at="" /> -->\n${content}\n`;
const store = (next = '0002') => `<!-- <psm-store version="1" next_id="${next}" group_dimension="" /> -->\n`;

/** 把发行产物复制到一个空目录：目录里没有任何源码、文档或依赖。 */
function isolatedRuntime() {
  const dir = temp();
  const file = path.join(dir, 'psm-cli.js');
  fs.copyFileSync(distribution, file);
  return { dir, file };
}

/** 在指定 cwd 里运行单文件产物。 */
function runIn(cwd, file, ...argv) {
  return execFileSync(process.execPath, [file, ...argv], { encoding: 'utf8', cwd, env: { ...process.env, PSM_QUIET: '1' } });
}

function runFailIn(cwd, file, ...argv) {
  try { runIn(cwd, file, ...argv); return null; } catch (error) { return error; }
}

/**
 * Given：一个只含单文件产物的空目录，没有 skill 源码、参考文档或 node_modules
 * When：执行 init / add / read / cache / validate
 * Then：全部命令可用，目录里只出现记忆数据与运行产物
 * 防回归：单文件产物暗中依赖相邻源码或第三方依赖
 */
test('single file runs every command without the skill directory', () => {
  const { dir, file } = isolatedRuntime();
  runIn(dir, file, 'init');
  const body = path.join(dir, 'conclusion.txt');
  fs.writeFileSync(body, '单文件运行时可用');

  assert.equal(runIn(dir, file, 'add', '--type', 'fact', '--content-file', body).trim(), '0001');
  assert.match(runIn(dir, file, 'read'), /单文件运行时可用/);
  assert.match(runIn(dir, file, 'validate'), /PSM_VALID/);
  assert.match(runIn(dir, file, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', body, '--source', 'test'), /pending/);
  assert.match(runIn(dir, file, 'cache', 'list'), /count/);

  // 目录里除了记忆数据与本次暂存，没有源码、模块树或查看器产物。
  const base = path.join(dir, '.project-self-memory');
  const files = fs.readdirSync(base)
    .filter((name) => fs.statSync(path.join(base, name)).isFile())
    .sort();
  assert.deepEqual(files, ['cache.jsonl', 'config.yaml', 'evidence.jsonl', 'memory.md']);
  assert.equal(fs.existsSync(path.join(dir, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(base, 'view-memoery.js')), false);
});

/**
 * Given：三种模块制式的消费项目（无 package 配置 / CommonJS / ESM）
 * When：在每个项目里启动同一个单文件产物
 * Then：三种制式都能初始化并读取，不要求消费项目修改模块配置
 * 防回归：交付物只在一种模块制式下可运行
 */
test('single file runs under no package, CommonJS and ESM projects', () => {
  const cases = [
    { name: 'no-package', manifest: null },
    { name: 'commonjs', manifest: { type: 'commonjs' } },
    { name: 'esm', manifest: { type: 'module' } },
  ];
  for (const item of cases) {
    const dir = path.join(temp(), item.name);
    fs.mkdirSync(dir, { recursive: true });
    if (item.manifest) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(item.manifest));
    const file = path.join(dir, 'psm-cli.js');
    fs.copyFileSync(distribution, file);
    runIn(dir, file, 'init');
    fs.writeFileSync(path.join(dir, '.project-self-memory', 'memory.md'), store('0002') + record('0001', `${item.name} 制式可用`));
    assert.match(runIn(dir, file, 'read'), new RegExp(`${item.name} 制式可用`), `${item.name} 应可运行`);
  }
});

/**
 * Given：部署到项目 .project-self-memory/ 的运行时副本
 * When：从无关 cwd 启动且不带 --project-root
 * Then：操作该运行时所属项目的记忆库
 * 防回归：项目副本在别的目录启动时误读写当前目录的记忆
 */
test('a deployed runtime binds to its own project regardless of cwd', () => {
  const project = temp();
  const source = path.join(project, '.project-self-memory', 'psm-cli.js');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.copyFileSync(distribution, source);
  runIn(project, source, 'init');
  const memory = path.join(project, '.project-self-memory', 'memory.md');
  fs.writeFileSync(memory, store('0002') + record('0001', '绑定项目记忆'));

  const elsewhere = temp();
  const out = execFileSync(process.execPath, [source, 'read'], { encoding: 'utf8', cwd: elsewhere });
  assert.match(out, /绑定项目记忆/);
});

/**
 * Given：部署在项目 A 的运行时副本
 * When：显式指定项目 B
 * Then：显式参数优先，运行时绑定不生效
 * 防回归：运行时绑定压过用户显式指定的项目
 */
test('an explicit project root overrides the runtime binding', () => {
  const bound = temp();
  const boundFile = path.join(bound, '.project-self-memory', 'psm-cli.js');
  fs.mkdirSync(path.dirname(boundFile), { recursive: true });
  fs.copyFileSync(distribution, boundFile);
  runIn(bound, boundFile, 'init');

  const explicit = temp();
  runIn(bound, boundFile, 'init', '--project-root', explicit);
  fs.writeFileSync(path.join(explicit, '.project-self-memory', 'memory.md'), store('0002') + record('0001', '显式项目记忆'));
  fs.writeFileSync(path.join(bound, '.project-self-memory', 'memory.md'), store('0002') + record('0001', '绑定项目记忆'));

  const out = execFileSync(process.execPath, [boundFile, 'read', '--project-root', explicit], { encoding: 'utf8' });
  assert.match(out, /显式项目记忆/);
  assert.doesNotMatch(out, /绑定项目记忆/);
});

/**
 * Given：带空格与中文的项目路径
 * When：在该目录启动单文件产物并读写记忆
 * Then：路径被正确解析，记忆库落在同一个目录
 * 防回归：路径转义或编码处理错误导致写错库
 */
test('paths with spaces and Chinese characters are handled', () => {
  const dir = path.join(temp(), '项目 目录 with space');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'psm-cli.js');
  fs.copyFileSync(distribution, file);
  runIn(dir, file, 'init');
  const body = path.join(dir, '结 论.txt');
  fs.writeFileSync(body, '空格与中文路径可用');
  assert.equal(runIn(dir, file, 'add', '--type', 'fact', '--content-file', body).trim(), '0001');
  assert.match(runIn(dir, file, 'read'), /空格与中文路径可用/);
  assert.ok(fs.existsSync(path.join(dir, '.project-self-memory', 'memory.md')));
});

/**
 * Given：一个没有 memory.md 的目录
 * When：启动 preview 并读取快照
 * Then：只读诊断说明缺库，且不隐式初始化或写入任何文件
 * 防回归：预览把「检查」变成「建库」
 */
test('preview on a missing store stays read-only and never initialises', async () => {
  const dir = temp();
  const file = path.join(dir, 'psm-cli.js');
  fs.copyFileSync(distribution, file);
  const before = fs.readdirSync(dir).sort();

  const child = spawn(process.execPath, [file, 'preview', '--no-open'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(Error(`启动超时: ${out}`)), 15000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/PSM_VIEWER_URL: (\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on('exit', (code) => reject(Error(`提前退出 code=${code}: ${out}`)));
  });
  try {
    const parsed = new URL(url);
    const res = await fetch(`http://127.0.0.1:${parsed.port}/api/snapshot`, { headers: { Authorization: `Bearer ${parsed.hash.replace('#token=', '')}` } });
    const snap = await res.json();
    assert.equal(snap.read_only, true);
    assert.ok(snap.diagnostics.some((item) => /memory\.md/.test(item.message)));
    assert.deepEqual(fs.readdirSync(dir).sort(), before);
  } finally { child.kill(); }
});

/**
 * Given：preview 与 CLI 同时指向同一个记忆库
 * When：CLI 先写入一条记录，再用 preview 之前取到的 store_revision 提交编辑
 * Then：preview 返回 409 冲突，磁盘保留 CLI 的写入结果
 * 防回归：统一入口引入第二套并发语义，两个写入方互相覆盖
 */
test('preview and CLI share one store and one concurrency contract', async () => {
  const { dir, file } = isolatedRuntime();
  runIn(dir, file, 'init');
  fs.writeFileSync(path.join(dir, '.project-self-memory', 'memory.md'), store('0002') + record('0001', '原文'));

  const child = spawn(process.execPath, [file, 'preview', '--no-open'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(Error(`启动超时: ${out}`)), 15000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/PSM_VIEWER_URL: (\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on('exit', (code) => reject(Error(`提前退出 code=${code}: ${out}`)));
  });
  try {
    const parsed = new URL(url);
    const token = parsed.hash.replace('#token=', '');
    const base = `http://127.0.0.1:${parsed.port}`;
    const snapshot = await fetch(`${base}/api/snapshot`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    const revision = snapshot.store_revision;

    // CLI 侧写入：走既有锁、备份与原子替换。
    const body = path.join(dir, 'cli-write.txt');
    fs.writeFileSync(body, 'CLI 写入的结论');
    runIn(dir, file, 'add', '--type', 'fact', '--content-file', body);

    // preview 用陈旧 revision 提交 → 409，磁盘保留 CLI 的结果。
    const stale = await fetch(`${base}/api/records/0001`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_revision: revision, content: 'preview 覆盖', type: 'fact', status: 'active' }),
    });
    assert.equal(stale.status, 409);
    const onDisk = fs.readFileSync(path.join(dir, '.project-self-memory', 'memory.md'), 'utf8');
    assert.match(onDisk, /CLI 写入的结论/);
    assert.doesNotMatch(onDisk, /preview 覆盖/);
  } finally { child.kill(); }
});

/**
 * Given：一个已被占用的端口
 * When：用该端口启动 preview
 * Then：明确失败退出并报告端口占用，不留下后台服务
 * 防回归：端口冲突被静默吞掉，用户以为服务已起
 */
test('preview fails clearly when the port is taken', async () => {
  const { dir, file } = isolatedRuntime();
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const port = holder.address().port;
  try {
    const error = runFailIn(dir, file, 'preview', '--port', String(port));
    assert.ok(error, '端口被占用时 preview 应当失败退出');
    assert.match(String(error.stderr), /PSM_VIEWER_ERROR/);
    assert.match(String(error.stderr), /端口被占用/);
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
});
