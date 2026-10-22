import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/memory.mjs');
const run = (root, ...argv) => execFileSync(process.execPath, [cli, '--project-root', root, ...argv], { encoding: 'utf8', env: { ...process.env, PSM_QUIET: '1' } });
const runFail = (root, ...argv) => { try { run(root, ...argv); return null; } catch (error) { return error; } };
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psm-deploy-'));
const target = (root) => path.join(root, '.project-self-memory', 'view-memoery.js');

/**
 * Given：全新项目
 * When：init
 * Then：查看器脚本随初始化部署到 .project-self-memory/
 * 防回归：新项目初始化后无法直接启动查看器
 */
test('init deploys the viewer beside the store', () => {
  const root = temp();
  run(root, 'init');
  assert.ok(fs.existsSync(target(root)));
  assert.match(fs.readFileSync(target(root), 'utf8'), /PSM_VIEWER_URL/);
});

/**
 * Given：已部署查看器且用户改过内容
 * When：重复 init 或 viewer update
 * Then：init 保留不动；update 拒绝覆盖，文件内容保持用户版本
 * 防回归：普通读取或初始化悄悄覆盖用户定制
 */
test('repeat init keeps, and update refuses, a locally modified script', () => {
  const root = temp();
  run(root, 'init');
  fs.appendFileSync(target(root), '\n// 用户定制\n');
  const customized = fs.readFileSync(target(root));
  run(root, 'init');
  assert.ok(fs.readFileSync(target(root)).equals(customized));
  const error = runFail(root, 'viewer', 'update');
  assert.ok(error);
  assert.match(String(error.stderr), /拒绝覆盖/);
  assert.ok(fs.readFileSync(target(root)).equals(customized));
});

/**
 * Given：库存在但没有查看器脚本
 * When：viewer install
 * Then：脚本安装；再次 install 报告无操作
 * 防回归：显式安装入口缺失或重复安装报错
 */
test('viewer install deploys to an existing project and is idempotent', () => {
  const root = temp();
  fs.mkdirSync(path.join(root, '.project-self-memory'), { recursive: true });
  const out = run(root, 'viewer', 'install');
  assert.match(out, /PSM_VIEWER_INSTALLED/);
  assert.match(run(root, 'viewer', 'install'), /PSM_VIEWER_CURRENT/);
});

/**
 * Given：目标是符号链接
 * When：viewer update
 * Then：拒绝替换
 * 防回归：跟随符号链接写穿到库外文件
 */
test('symlink target is always refused', () => {
  const root = temp();
  run(root, 'init');
  const real = path.join(root, 'real-target.js');
  fs.writeFileSync(real, '// real\n');
  fs.rmSync(target(root));
  fs.symlinkSync(real, target(root));
  const error = runFail(root, 'viewer', 'update');
  assert.ok(error);
  assert.match(String(error.stderr), /符号链接/);
  assert.equal(fs.readFileSync(real, 'utf8'), '// real\n');
});

/**
 * Given：viewer status
 * When：脚本缺失 / 官方原版 / 本地修改三种状态
 * Then：分别报告 exists=false、official=true、official=false
 * 防回归：状态判断只看文件自报版本
 */
test('viewer status distinguishes missing, official and modified', () => {
  const root = temp();
  fs.mkdirSync(path.join(root, '.project-self-memory'), { recursive: true });
  assert.equal(JSON.parse(run(root, 'viewer', 'status')).exists, false);
  run(root, 'viewer', 'install');
  assert.equal(JSON.parse(run(root, 'viewer', 'status')).official, true);
  fs.appendFileSync(target(root), '\n// 改动\n');
  const status = JSON.parse(run(root, 'viewer', 'status'));
  assert.equal(status.official, false);
  assert.equal(status.up_to_date, false);
});
