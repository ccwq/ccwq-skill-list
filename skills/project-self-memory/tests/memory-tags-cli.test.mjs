import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MemorySession } from '../scripts/memory-session.mjs';
const cli = fileURLToPath(new URL('../scripts/memory.mjs', import.meta.url));
const run = (root, ...args) => execFileSync(process.execPath, [cli, '--project-root', root, ...args], { encoding: 'utf8', env: { ...process.env, PSM_QUIET: '1' } });

/**
 * Given：项目有跨主机正文与已有评分
 * When：配置分类标准、设置人工标签并按标签读取
 * Then：inspect 自动派生多标签，正文与评分版本不变，读取不写盘
 * 防回归：分类维护破坏主库或标签未接入 MemorySession 的 inspect 入口
 */
test('CLI derives optional tags, filters reads and keeps evidence identity unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-tags-cli-'));
  run(root, 'init');
  const body = path.join(root, 'body.txt');
  fs.writeFileSync(body, '[host_scope=tenc] OmniRoute links qxub');
  run(root, 'add', '--type', 'fact', '--content-file', body);
  run(root, 'score', '0001', '+1');
  const before = JSON.parse(run(root, 'inspect', '0001'));
  const main = path.join(root, '.project-self-memory', 'memory.md');
  const raw = fs.readFileSync(main);
  const plan = path.join(root, 'plan.json');
  fs.writeFileSync(plan, JSON.stringify({ version: 1, tags: [{ name: 'host:qxub', any: ['qxub'] }], overrides: {} }));
  run(root, 'tags', 'apply', '--plan-file', plan);
  run(root, 'tags', 'set', '0001', '--add', 'component:omniroute');
  const after = JSON.parse(run(root, 'inspect', '0001'));
  assert.deepEqual(after.tags, ['host:qxub', 'component:omniroute', 'host_scope:tenc']);
  assert.equal(after.record_version, before.record_version);
  assert.equal(after.positive, before.positive);
  assert.ok(fs.readFileSync(main).equals(raw));
  assert.match(run(root, 'read', '--tag', 'host:qxub'), /OmniRoute/);
  assert.equal(run(root, 'read', '--tag', 'host:missing'), '');
  assert.equal(JSON.parse(run(root, 'catalog', '--by', 'tag')).find((tag) => tag.name === 'host:qxub').count, 1);
  const files = ['memory.md', 'evidence.jsonl', 'tags.json'].map((name) => path.join(root, '.project-self-memory', name));
  const bytes = files.map((file) => fs.readFileSync(file));
  run(root, 'tags', 'suggest'); run(root, 'tags', 'stats'); run(root, 'inspect');
  files.forEach((file, index) => assert.ok(fs.readFileSync(file).equals(bytes[index])));
});

/**
 * Given：分类文件非法，但正文和证据账本有效
 * When：读取、添加与评分，同时检查诊断
 * Then：业务命令正常，标签为空且诊断提供非致命警告
 * 防回归：可选分类文件损坏导致整个 MemorySession 关闭
 */
test('malformed taxonomy does not block ordinary memory reads or writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-tags-fallback-'));
  run(root, 'init');
  const body = path.join(root, 'body.txt'); fs.writeFileSync(body, '[host_scope=tenc] original');
  const tags = path.join(root, '.project-self-memory', 'tags.json'); fs.writeFileSync(tags, '{');
  run(root, 'add', '--type', 'fact', '--content-file', body);
  run(root, 'score', '0001', '+1');
  assert.match(run(root, 'validate'), /PSM_VALID/);
  assert.match(run(root, 'read'), /original/);
  assert.deepEqual(JSON.parse(run(root, 'inspect', '0001')).tags, []);
  const diagnosis = JSON.parse(run(root, 'diagnose'));
  assert.equal(diagnosis.tags[0].impact, 'warning');
  assert.equal(diagnosis.write_safe, true);
  assert.equal(fs.readFileSync(tags, 'utf8'), '{');
});

/**
 * Given：真实 CLI 返回带派生标签的结构化记忆
 * When：MemorySession 开始带标签意图的任务
 * Then：最终宿主记忆包含标签，关闭加载时仍不泄露正文
 * 防回归：标签仅存在于查看器而未进入真实自动召回链路
 */
test('MemorySession receives derived tags through the real inspect command', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-tags-session-'));
  run(root, 'init');
  const body = path.join(root, 'body.txt'); fs.writeFileSync(body, '[host_scope=tenc] proxy maintenance');
  run(root, 'add', '--type', 'fact', '--content-file', body);
  const session = new MemorySession({ projectRoot: root, cliPath: cli });
  const result = await session.beginTask({ query: 'proxy maintenance', tags: ['host_scope:tenc'] });
  assert.ok(result);
  assert.deepEqual([...session.loadedRecords.values()][0].tags, ['host_scope:tenc']);
  const off = new MemorySession({ projectRoot: root, cliPath: cli, policy: { auto_load: false, auto_save: false, auto_rate: false } });
  await off.beginTask({ query: 'proxy' });
  assert.equal(off.loadedRecords.size, 0);
});

/**
 * Given：项目已有分类标准，备份目录后来被文件占用
 * When：显式替换标准触发备份失败
 * Then：命令失败，原分类标准保持逐字节不变
 * 防回归：缺少恢复点时仍然覆盖用户分类标准
 */
test('taxonomy replacement fails closed when its backup cannot be written', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-tags-backup-'));
  run(root, 'init');
  const base = path.join(root, '.project-self-memory');
  const file = path.join(base, 'tags.json');
  const old = '{"version":1,"tags":[],"overrides":{}}'; fs.writeFileSync(file, old);
  fs.writeFileSync(path.join(base, 'backups'), 'blocked');
  const plan = path.join(root, 'plan.json'); fs.writeFileSync(plan, '{"version":1,"tags":[{"name":"new"}]}');
  assert.throws(() => run(root, 'tags', 'apply', '--plan-file', plan));
  assert.equal(fs.readFileSync(file, 'utf8'), old);
  assert.equal(fs.existsSync(path.join(base, 'memory.lock')), false);
});
