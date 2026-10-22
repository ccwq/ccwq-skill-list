import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/memory.mjs');
const run = (root, ...argv) => execFileSync(process.execPath, [cli, '--project-root', root, ...argv], { encoding: 'utf8', env: { ...process.env, PSM_QUIET: '1' } });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psm-lock-'));
const memory = (root) => path.join(root, '.project-self-memory', 'memory.md');
const lock = (root) => path.join(root, '.project-self-memory', 'memory.lock');
const body = (root, text) => { const f = path.join(root, 'body.txt'); fs.writeFileSync(f, text); return f; };
const record = (id, content) => `<!-- <psm id="${id}" type="fact" status="active" positive="0" negative="0" created_at="2026-08-05T00:00:00Z" last_scored_at="" /> -->\n${content}\n`;
const store = (next = '0002') => `<!-- <psm-store version="1" next_id="${next}" group_dimension="" /> -->\n`;

/**
 * Given：已 init 的库
 * When：执行一次 add
 * Then：写入前产生带时间戳的备份，备份字节与原文件一致
 * 防回归：写入失败时无恢复点
 */
test('every durable write creates a verified backup', () => {
  const root = temp(); run(root, 'init');
  const before = fs.readFileSync(memory(root));
  run(root, 'add', '--type', 'fact', '--content-file', body(root, '甲'));
  const dir = path.join(root, '.project-self-memory', 'backups');
  const names = fs.readdirSync(dir);
  assert.equal(names.length, 1);
  assert.ok(fs.readFileSync(path.join(dir, names[0])).equals(before));
});

/**
 * Given：一个活进程持有的 memory.lock（当前进程 pid）
 * When：另一个 CLI 写入尝试以短超时获取锁
 * Then：拒绝并保留原文件，不凭锁年龄强删
 * 防回归：凭锁文件年龄删除活进程持有的锁导致并发写
 */
test('live lock blocks writers instead of being deleted by age', () => {
  const root = temp(); run(root, 'init');
  fs.writeFileSync(lock(root), JSON.stringify({ pid: process.pid, created_at: new Date(Date.now() - 3600e3).toISOString() }));
  const before = fs.readFileSync(memory(root));
  assert.throws(() => run(root, 'add', '--type', 'fact', '--content-file', body(root, '甲')), /锁超时/);
  assert.ok(fs.readFileSync(memory(root)).equals(before));
  fs.unlinkSync(lock(root));
});

/**
 * Given：库文件在一个写入进程的「加载后、保存前」被外部追加分组
 * When：该进程基于旧模型完成写入
 * Then：返回 PSM_CONFLICT，不自动合并基线外字段
 * 防回归：保守策略退化——外部改分组/next_id 时旧模型静默覆盖
 */
test('baseline divergence in groups or next_id is a conflict, not a merge', async () => {
  const root = temp(); run(root, 'init');
  // add 不带 --content-file 时会读 stdin；保持 stdin 打开让子进程停在
  // loadStore（已打基线）之后、save 之前。
  const child = execFile(process.execPath, [cli, '--project-root', root, 'add', '--type', 'fact'],
    { env: { ...process.env, PSM_QUIET: '1' } }, () => {});
  await new Promise((r) => setTimeout(r, 300)); // 等子进程完成加载并阻塞在 stdin
  const text = fs.readFileSync(memory(root), 'utf8').replace('group_dimension=""', 'group_dimension="topic"')
    + '\n## 主题甲\n<!-- <psm-group id="topic-a" scope="测试" /> -->\n';
  fs.writeFileSync(memory(root), text);
  child.stdin.end('冲突正文');
  const exit = await new Promise((resolve) => {
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('exit', (code) => resolve({ code, stderr }));
  });
  assert.notEqual(exit.code, 0);
  assert.match(exit.stderr, /PSM_CONFLICT/);
  // 分组未被旧模型覆盖。
  assert.match(fs.readFileSync(memory(root), 'utf8'), /psm-group id="topic-a"/);
});

/**
 * Given：pid 已不存在的陈旧 memory.lock
 * When：CLI 写入
 * Then：回收锁并正常写入
 * 防回归：崩溃残留锁永久阻断维护
 */
test('dead-owner lock is reclaimed', () => {
  const root = temp(); run(root, 'init');
  fs.writeFileSync(lock(root), JSON.stringify({ pid: 4294967294, created_at: new Date().toISOString() }));
  assert.equal(run(root, 'add', '--type', 'fact', '--content-file', body(root, '甲')).trim(), '0001');
});

/**
 * Given：无实际内容变化的 status 设置（状态已是目标值）
 * When：再次执行 status
 * Then：文件字节不变且不新增备份
 * 防回归：无变化保存制造噪音备份与假版本
 */
test('no-change save skips backup and rewrite', () => {
  const root = temp(); run(root, 'init');
  run(root, 'add', '--type', 'fact', '--content-file', body(root, '甲'));
  const dir = path.join(root, '.project-self-memory', 'backups');
  const backupsBefore = fs.readdirSync(dir).length;
  const before = fs.readFileSync(memory(root));
  run(root, 'status', '0001', 'active');
  assert.equal(fs.readdirSync(dir).length, backupsBefore);
  assert.ok(fs.readFileSync(memory(root)).equals(before));
});

/**
 * Given：两个并发 add 进程
 * When：同时写入同一库
 * Then：两个都成功且产生两条不同 ID 的记录（串行化生效）
 * 防回归：并发写造成丢失更新
 */
test('concurrent CLI writers serialize through the lock', async () => {
  const root = temp(); run(root, 'init');
  const add = (text) => new Promise((resolve, reject) => {
    execFile(process.execPath, [cli, '--project-root', root, 'add', '--type', 'fact', '--content-file', body(root, text)], { env: { ...process.env, PSM_QUIET: '1' } }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  });
  const [a, b] = await Promise.all([add('并发甲'), add('并发乙')]);
  assert.notEqual(a, b);
  const model = JSON.parse(run(root, 'inspect'));
  assert.equal(model.records.length, 2);
});

/**
 * Given：备份目录不可写（文件占用同名路径）
 * When：执行 add
 * Then：命令失败且原文件保持可用
 * 防回归：备份失败仍提交写入造成无恢复点
 */
test('backup failure aborts the write and keeps the original readable', () => {
  const root = temp(); run(root, 'init');
  // Occupy the backups path with a file so mkdir fails.
  fs.writeFileSync(path.join(root, '.project-self-memory', 'backups'), 'blocked');
  const before = fs.readFileSync(memory(root));
  assert.throws(() => run(root, 'add', '--type', 'fact', '--content-file', body(root, '甲')));
  assert.ok(fs.readFileSync(memory(root)).equals(before));
  assert.match(run(root, 'validate'), /PSM_VALID/);
});

/**
 * Given：update 修改记录正文
 * When：检查创建时间与记录版本
 * Then：created_at 不变；版本哈希变化；账本无新增评分事件
 * 防回归：编辑悄悄重写审计字段
 */
test('update preserves created_at and does not append ledger events', () => {
  const root = temp(); run(root, 'init');
  fs.writeFileSync(memory(root), store('0002') + record('0001', '原文'));
  const ledger = path.join(root, '.project-self-memory', 'evidence.jsonl');
  const eventsBefore = fs.readFileSync(ledger, 'utf8');
  run(root, 'update', '0001', '--content-file', body(root, '新文'));
  const after = JSON.parse(run(root, 'inspect', '0001'));
  assert.equal(after.created_at, '2026-08-05T00:00:00Z');
  assert.equal(fs.readFileSync(ledger, 'utf8'), eventsBefore);
});
