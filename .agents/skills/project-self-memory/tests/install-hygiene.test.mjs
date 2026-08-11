import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validationRoot = path.resolve('E:/project/self.project/skillopt-validation');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psm-install-hygiene-'));

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.agents' || entry.name === 'tests') continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

function runtimeEntries(root) {
  const found = [];
  const visit = (current) => {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.relative(root, full);
      if (entry.name === '.agents'
        || /\.(pid|port|stream)$/i.test(entry.name)
        || entry.name === '.project-self-memory') found.push(rel);
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(full);
    }
  };
  visit(root);
  return found.sort();
}

/**
 * Given：source Skill 可能含有既有 .agents/lock/runtime 污染
 * When：复制可运行内容到 disposable copy，并从另一 cwd 执行 host
 * Then：copy 能独立运行，source 与 validation 项目根的运行时集合不新增
 * 防回归：安装测试反向把运行时目录、lockfile 或递归 Skill 写回真实工作区
 */
test('disposable-copy installation does not pollute source or project root', () => {
  assert.equal(fs.existsSync(path.join(sourceRoot, 'skills-lock.json')), false);
  const beforeSource = runtimeEntries(sourceRoot);
  const beforeValidation = runtimeEntries(validationRoot);
  const installRoot = temp();
  const projectRoot = temp();
  const cwd = temp();
  copyTree(sourceRoot, installRoot);
  assert.equal(fs.existsSync(path.join(sourceRoot, '.project-self-memory')), false);
  const output = JSON.parse(execFileSync(process.execPath, [
    path.join(installRoot, 'scripts', 'reference-host.mjs'),
    '--project-root', projectRoot,
  ], { cwd, encoding: 'utf8' }));
  assert.equal(output.payload.memory.length, 0);
  assert.equal(output.capabilities.filesystem, false);
  assert.deepEqual(runtimeEntries(sourceRoot), beforeSource);
  assert.deepEqual(runtimeEntries(validationRoot), beforeValidation);
  assert.equal(fs.existsSync(path.join(installRoot, '.agents')), false);
  assert.equal(fs.existsSync(path.join(installRoot, '.project-self-memory')), false);
  assert.equal(runtimeEntries(installRoot).some((entry) => path.basename(entry) === 'skills-lock.json'), false);
});
