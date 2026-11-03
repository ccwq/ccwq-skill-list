#!/usr/bin/env node
/**
 * git-up 双端验证入口。
 *
 * 在当前平台依次跑语义套件与计划套件，汇总 PASS、SKIP、FAIL 并给出退出码。
 * Windows 与 Linux 用同一份脚本，避免两端的验证命令分叉。
 *
 * 用法：
 *   node test-space/git-up-dual-platform/run_all.mjs
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SUITES = [
  { name: '语义拆分', script: path.join(ROOT, 'test-space', 'git-up-semantic-tests', 'run_tests.mjs') },
  { name: '计划级', script: path.join(ROOT, 'test-space', 'git-up-commit-plan-tests', 'run_tests.mjs') },
  { name: '性能回归', script: path.join(ROOT, 'test-space', 'git-up-perf-tests', 'run_tests.mjs') },
];

function countLines(text, prefix) {
  return text.split('\n').filter((line) => line.startsWith(prefix)).length;
}

console.log(`平台：${process.platform} ${process.arch}，Node ${process.version}`);
console.log(`内核：${os.type()} ${os.release()}`);
console.log('');

let failed = false;
for (const suite of SUITES) {
  const result = spawnSync(process.execPath, [suite.script], { cwd: ROOT, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const pass = countLines(output, 'PASS');
  const skip = countLines(output, 'SKIP');
  const fail = countLines(output, 'FAIL');

  console.log(`${suite.name}套件：PASS=${pass} SKIP=${skip} FAIL=${fail} 退出码=${result.status}`);

  for (const line of output.split('\n')) {
    if (line.startsWith('FAIL') || line.startsWith('SKIP')) console.log(`  ${line}`);
  }
  if (result.status !== 0) failed = true;
  console.log('');
}

if (failed) {
  console.log('双端验证失败：至少一个套件有失败用例。');
  process.exit(1);
}
console.log('双端验证通过：所有套件无失败用例。');
