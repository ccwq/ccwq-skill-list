import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReferenceHost } from '../scripts/reference-host.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = path.join(skillRoot, 'scripts', 'reference-host.mjs');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psm-reference-host-'));
const init = (projectRoot) => execFileSync(process.execPath, [
  path.join(skillRoot, 'scripts', 'memory.mjs'), '--project-root', projectRoot, 'init',
], { encoding: 'utf8' });

/**
 * Given：host 收到一个只用于探测泄漏的唯一 sentinel，且 auto_load=false
 * When：执行 reference host 的完整 beginTask/endTask 生命周期
 * Then：最终 payload 不包含 sentinel，且 capabilities 拒绝 raw memory/shell/fs
 * 防回归：把宿主任务输入或高权限工具误传给 Agent
 */
test('auto_load=false keeps sentinel out of payload and denies raw capabilities', async () => {
  const sentinel = `HOST_SENTINEL_${Date.now()}_${Math.random()}`;
  const projectRoot = temp();
  init(projectRoot);
  const result = await runReferenceHost({ projectRoot, autoLoad: false, context: sentinel });
  assert.doesNotMatch(JSON.stringify(result.payload), new RegExp(sentinel));
  assert.equal(result.payload.memory.length, 0);
  assert.equal(result.capabilities.directMemoryStore, false);
  assert.equal(result.capabilities.directMemoryCli, false);
  assert.equal(result.capabilities.shell, false);
  assert.equal(result.capabilities.filesystem, false);
  assert.equal(result.capabilities.memoryContext, false);
  assert.ok(result.audit.some((event) => event.event === 'memory.load' && event.reason === 'policy-disabled'));
  assert.ok(result.end.audit.some((event) => event.event === 'memory.save'));
});

/**
 * Given：source Skill 与 subject Junction 指向同一 adapter，启动 cwd 各不相同
 * When：分别通过 node CLI 执行 reference host
 * Then：两次都返回同一 payload/capability 形状，且不依赖 cwd 解析 runtime
 * 防回归：adapter 用 process.cwd() 拼接 memory-session 或 memory.mjs 路径
 */
test('source and subject Junction entrances are cwd-independent', () => {
  const projectRoot = temp();
  init(projectRoot);
  const sourceHost = host;
  const junctionHost = path.resolve('E:/project/self.project/skillopt-validation/subject/project-self-memory/scripts/reference-host.mjs');
  const cwdA = temp();
  const cwdB = temp();
  const run = (entry, cwd) => JSON.parse(execFileSync(process.execPath, [entry, '--project-root', projectRoot], {
    cwd,
    encoding: 'utf8',
  }));
  const source = run(sourceHost, cwdA);
  const junction = run(junctionHost, cwdB);
  assert.deepEqual(source.payload.memory, junction.payload.memory);
  assert.deepEqual(source.capabilities, junction.capabilities);
  assert.deepEqual(source.end.added, junction.end.added);
  assert.deepEqual(source.end.rated, junction.end.rated);
  assert.equal(source.projectRoot, junction.projectRoot);
});
