import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../scripts/memory.mjs');
const runtimeBuilder = path.resolve(here, '../scripts/build-runtime.mjs');
const distribution = path.resolve(here, '../runtime-dist/psm-cli.js');
const run = (root, ...argv) => execFileSync(process.execPath, [cli, '--project-root', root, ...argv], { encoding: 'utf8', env: { ...process.env, PSM_QUIET: '1' } });
const runFail = (root, ...argv) => { try { run(root, ...argv); return null; } catch (error) { return error; } };
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psm-runtime-'));
const target = (root) => path.join(root, '.project-self-memory', 'psm-cli.js');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
/** 官方产物按发布形态（LF）计算哈希：检出行尾不参与识别。 */
const publishedSha = (file) => sha(Buffer.from(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), 'utf8'));

/**
 * Given：全新项目
 * When：init
 * Then：只创建记忆数据，不部署 CLI 或独立查看器
 * 防回归：初始化顺手往项目里塞可执行文件，污染项目内容
 */
test('init deploys no executable at all', () => {
  const root = temp();
  run(root, 'init');
  const base = path.join(root, '.project-self-memory');
  assert.ok(fs.existsSync(path.join(base, 'memory.md')));
  assert.ok(fs.existsSync(path.join(base, 'config.yaml')));
  assert.equal(fs.existsSync(target(root)), false);
  assert.equal(fs.existsSync(path.join(base, 'view-memoery.js')), false);
});

/**
 * Given：已初始化的项目
 * When：重复 init
 * Then：既不部署运行时也不改动既有数据字节
 * 防回归：重复初始化悄悄升级或重写项目内容
 */
test('repeat init keeps data bytes and deploys nothing', () => {
  const root = temp();
  run(root, 'init');
  const memory = path.join(root, '.project-self-memory', 'memory.md');
  const before = fs.readFileSync(memory);
  run(root, 'init');
  assert.ok(fs.readFileSync(memory).equals(before));
  assert.equal(fs.existsSync(target(root)), false);
});

/**
 * Given：没有运行时副本的项目
 * When：runtime install
 * Then：只落一个 psm-cli.js；重复 install 报告无变化
 * 防回归：部署带上整套 skill、源码模块树或旧查看器产物
 */
test('runtime install deploys exactly one file and is idempotent', () => {
  const root = temp();
  run(root, 'init');
  const out = run(root, 'runtime', 'install');
  assert.match(out, /PSM_RUNTIME_INSTALLED/);
  assert.ok(fs.existsSync(target(root)));
  const base = path.join(root, '.project-self-memory');
  const files = fs.readdirSync(base).filter((name) => name !== 'backups');
  assert.deepEqual(files.sort(), ['config.yaml', 'evidence.jsonl', 'memory.md', 'psm-cli.js']);
  assert.match(run(root, 'runtime', 'install'), /PSM_RUNTIME_CURRENT/);
});

/**
 * Given：目标位置已有未知内容
 * When：runtime install
 * Then：拒绝覆盖，原文件保持原样，提示改用显式升级
 * 防回归：install 变成强制覆盖入口，冲掉项目定制
 */
test('runtime install refuses to overwrite an unknown existing file', () => {
  const root = temp();
  run(root, 'init');
  const file = target(root);
  fs.writeFileSync(file, '// 本地定制\n');
  const error = runFail(root, 'runtime', 'install');
  assert.ok(error);
  assert.match(String(error.stderr), /PSM_RUNTIME_REFUSED/);
  assert.equal(fs.readFileSync(file, 'utf8'), '// 本地定制\n');
});

/**
 * Given：目标位置是符号链接
 * When：runtime install
 * Then：拒绝写入，不跟随链接写穿
 * 防回归：部署顺着链接改到项目外的文件
 */
test('runtime install refuses a symlink target', () => {
  const root = temp();
  run(root, 'init');
  const real = path.join(root, 'real-target.js');
  fs.writeFileSync(real, '// real\n');
  fs.symlinkSync(real, target(root));
  const error = runFail(root, 'runtime', 'install');
  assert.ok(error);
  assert.match(String(error.stderr), /符号链接/);
  assert.equal(fs.readFileSync(real, 'utf8'), '// real\n');
});

/**
 * Given：项目里没有运行时副本
 * When：runtime status
 * Then：只读报告 exists=false，不写任何文件
 * 防回归：状态查询本身改动项目
 */
test('runtime status is read-only and reports a missing copy', () => {
  const root = temp();
  run(root, 'init');
  const before = fs.readdirSync(path.join(root, '.project-self-memory')).sort();
  const status = JSON.parse(run(root, 'runtime', 'status'));
  assert.equal(status.exists, false);
  assert.equal(status.official, false);
  assert.equal(status.up_to_date, false);
  assert.ok(Array.isArray(status.diagnostics));
  assert.deepEqual(fs.readdirSync(path.join(root, '.project-self-memory')).sort(), before);
});

/**
 * Given：项目里已有当前官方运行时副本
 * When：runtime status
 * Then：报告 official=true、up_to_date=true
 * 防回归：官方识别只看文件自报版本或总是判成未知
 */
test('runtime status recognises the current official copy', () => {
  const root = temp();
  run(root, 'init');
  run(root, 'runtime', 'install');
  const status = JSON.parse(run(root, 'runtime', 'status'));
  assert.equal(status.exists, true);
  assert.equal(status.official, true);
  assert.equal(status.up_to_date, true);
  assert.equal(status.hash, publishedSha(distribution));
});

/**
 * Given：项目里已有本地修改过的运行时副本
 * When：runtime status
 * Then：official=false、up_to_date=false，并给出可定位诊断
 * 防回归：本地修改被误判成官方产物
 */
test('runtime status distinguishes a locally modified copy', () => {
  const root = temp();
  run(root, 'init');
  run(root, 'runtime', 'install');
  fs.appendFileSync(target(root), '\n// 改动\n');
  const status = JSON.parse(run(root, 'runtime', 'status'));
  assert.equal(status.official, false);
  assert.equal(status.up_to_date, false);
  assert.match(status.diagnostics.join('；'), /本地修改/);
});

/**
 * Given：项目里已有官方旧版运行时副本
 * When：runtime update
 * Then：备份原文件后原子替换为当前官方产物；记忆数据字节不变
 * 防回归：升级无备份、或升级过程连带改动记忆库
 */
test('runtime update replaces a known official older copy after backing it up', () => {
  const root = temp();
  run(root, 'init');
  // 构造一个「已发布的官方旧版」：用改了版本号的发行信息重新构建一次产物，
  // 并把上一版的哈希登记为已知官方哈希。
  const older = buildRelease({ version: '0.9.0' });
  fs.writeFileSync(target(root), older.bytes);
  const memory = path.join(root, '.project-self-memory', 'memory.md');
  const memoryBefore = fs.readFileSync(memory);

  const error = runFail(root, 'runtime', 'update');
  assert.ok(error, '当前发行信息未登记该旧版时应拒绝升级');

  // 用登记了旧版哈希的发行产物执行升级。
  const newer = buildRelease({ knownHashes: [older.hash] });
  const result = execFileSync(process.execPath, [newer.path, 'runtime', 'update', '--project-root', root], { encoding: 'utf8' });
  assert.match(result, /PSM_RUNTIME_UPDATED/);
  assert.equal(fs.readFileSync(target(root)).equals(newer.bytes), true);
  const backups = fs.readdirSync(path.join(root, '.project-self-memory', 'backups'));
  assert.ok(backups.some((name) => name.startsWith('psm-cli-')));
  assert.ok(fs.readFileSync(memory).equals(memoryBefore));
});

/**
 * Given：项目里已有官方旧版运行时副本，但备份目录不可用
 * When：runtime update
 * Then：升级失败并保留原文件，不留下半替换状态
 * 防回归：备份阶段失败仍继续替换，原文件丢失
 */
test('runtime update keeps the original file when the backup cannot be written', () => {
  const root = temp();
  run(root, 'init');
  const older = buildRelease({ version: '0.9.0' });
  fs.writeFileSync(target(root), older.bytes);
  const before = fs.readFileSync(target(root));

  // 用同名普通文件占住备份目录，使备份写入必然失败。
  const backups = path.join(root, '.project-self-memory', 'backups');
  fs.writeFileSync(backups, 'not a directory');

  const newer = buildRelease({ knownHashes: [older.hash] });
  const error = (() => {
    try {
      execFileSync(process.execPath, [newer.path, 'runtime', 'update', '--project-root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return null;
    } catch (failure) { return failure; }
  })();
  assert.ok(error, '备份不可写时升级应当失败');
  assert.ok(fs.readFileSync(target(root)).equals(before), '原文件应保持不变');
});

/**
 * Given：项目里已有本地修改过的运行时副本
 * When：runtime update
 * Then：拒绝覆盖，文件字节保持不变
 * 防回归：升级把项目定制冲掉
 */
test('runtime update refuses a locally modified copy', () => {
  const root = temp();
  run(root, 'init');
  run(root, 'runtime', 'install');
  fs.appendFileSync(target(root), '\n// 改动\n');
  const customized = fs.readFileSync(target(root));
  const error = runFail(root, 'runtime', 'update');
  assert.ok(error);
  assert.match(String(error.stderr), /PSM_RUNTIME_REFUSED/);
  assert.ok(fs.readFileSync(target(root)).equals(customized));
});

/**
 * Given：项目里没有运行时副本
 * When：runtime update
 * Then：明确失败并指向 runtime install，不自行创建
 * 防回归：update 隐式安装
 */
test('runtime update refuses to install implicitly', () => {
  const root = temp();
  run(root, 'init');
  const error = runFail(root, 'runtime', 'update');
  assert.ok(error);
  assert.match(String(error.stderr), /runtime install/);
  assert.equal(fs.existsSync(target(root)), false);
});

/**
 * Given：旧独立查看器部署命令
 * When：执行 viewer install / viewer update
 * Then：退出码非零，明确说明未执行，并给出统一 preview 与 runtime 的迁移方向
 * 防回归：弃用命令假装成功，用户以为旧查看器已升级
 */
test('deprecated viewer write commands refuse and point to the new entry', () => {
  const root = temp();
  run(root, 'init');
  for (const sub of ['install', 'update']) {
    const error = runFail(root, 'viewer', sub);
    assert.ok(error, `${sub} 应当失败退出`);
    assert.equal(error.status, 1);
    assert.match(String(error.stderr), /PSM_VIEWER_DEPRECATED/);
    assert.match(String(error.stderr), /preview/);
    assert.match(String(error.stderr), /runtime install/);
  }
});

/**
 * Given：项目里已有旧独立查看器
 * When：viewer status
 * Then：继续只读输出既有状态字段并补充弃用诊断
 * 防回归：兼容命令消失，用户无法确认旧查看器状态
 */
test('viewer status stays read-only and reports deprecation', () => {
  const root = temp();
  run(root, 'init');
  const legacy = path.join(root, '.project-self-memory', 'view-memoery.js');
  // 官方产物以 LF 形态发布（工作区检出可能是 CRLF），哈希识别按发布形态计算。
  fs.writeFileSync(legacy, fs.readFileSync(path.resolve(here, '../viewer-dist/view-memoery.js'), 'utf8').replace(/\r\n/g, '\n'));
  const status = JSON.parse(run(root, 'viewer', 'status'));
  assert.equal(status.exists, true);
  assert.equal(status.official, true);
  assert.equal(status.up_to_date, true);
  assert.equal(status.deprecated, true);
  assert.ok(status.diagnostics.length >= 1);
});

/**
 * Given：构建器与源码
 * When：连续构建两次并执行 --check
 * Then：两次产物字节一致；--check 通过且不写文件
 * 防回归：产物随源码或时间漂移，发行哈希不可信
 */
test('runtime build is reproducible and drift-checkable', () => {
  const before = fs.readFileSync(distribution);
  execFileSync(process.execPath, [runtimeBuilder], { encoding: 'utf8' });
  const after = fs.readFileSync(distribution);
  // 比对按内容归一化行尾：产物本身是 LF，Windows 检出后磁盘上可能是 CRLF。
  const normalize = (bytes) => bytes.toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(normalize(before), normalize(after));
  // 一致性检查能发现真实漂移：改动产物后 --check 必须失败。
  fs.writeFileSync(distribution, `${after.toString('utf8')}\n// 漂移\n`);
  const drift = (() => {
    try { execFileSync(process.execPath, [runtimeBuilder, '--check'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return null; }
    catch (failure) { return failure; }
  })();
  assert.ok(drift, '产物与源码漂移时 --check 必须失败');
  assert.match(String(drift.stderr), /PSM_RUNTIME_DRIFT/);
  // 还原工作区原始字节，测试不把仓库变成 dirty。
  fs.writeFileSync(distribution, before);
  const check = execFileSync(process.execPath, [runtimeBuilder, '--check'], { encoding: 'utf8' });
  assert.match(check, /PSM_RUNTIME_CONSISTENT/);
});

/**
 * 在临时目录复制脚本源并重新构建一个发行产物。
 * @param {{version?: string, knownHashes?: string[]}} options 版本号与已知官方旧版哈希
 * @returns {{path: string, bytes: Buffer, hash: string}} 产物路径、字节与发布形态哈希
 */
function buildRelease({ version, knownHashes = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-release-'));
  const scripts = path.join(dir, 'scripts');
  fs.mkdirSync(scripts);
  for (const name of fs.readdirSync(path.resolve(here, '../scripts'))) {
    fs.copyFileSync(path.resolve(here, '../scripts', name), path.join(scripts, name));
  }
  const info = path.join(scripts, 'release-info.mjs');
  let source = fs.readFileSync(info, 'utf8');
  if (version) source = source.replace(/runtimeVersion = '[^']*'/, `runtimeVersion = '${version}'`);
  if (knownHashes.length) {
    const list = knownHashes.map((hash) => `  '${hash}',`).join('\n');
    source = source.replace(/knownRuntimeHashes = \[/, `knownRuntimeHashes = [\n${list}`);
  }
  fs.writeFileSync(info, source);
  execFileSync(process.execPath, [path.join(scripts, 'build-runtime.mjs'), '--out-dir', dir], { encoding: 'utf8' });
  const file = path.join(dir, 'runtime-dist', 'psm-cli.js');
  const bytes = fs.readFileSync(file);
  return { path: file, bytes, hash: sha(bytes) };
}
