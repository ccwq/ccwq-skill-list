import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendEvent,
  initializeLedger,
  inspectLedger,
  recordVersion,
  validateLedger,
} from '../scripts/evidence-ledger.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../scripts/memory.mjs');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psm-evidence-'));
const run = (root, ...args) => execFileSync(process.execPath, [cli, '--project-root', root, ...args], { encoding: 'utf8' });
const runFail = (root, ...args) => assert.throws(() => run(root, ...args));
const memory = (root) => path.join(root, '.project-self-memory', 'memory.md');
const ledger = (root) => path.join(root, '.project-self-memory', 'evidence.jsonl');
const body = (root, name, value) => { const file = path.join(root, name); fs.writeFileSync(file, value); return file; };
function init(root) { run(root, 'init'); }
function add(root, content = 'ledger sentinel') { return run(root, 'add', '--type', 'fact', '--content-file', body(root, 'content.txt', content)).trim(); }
function inspect(root, id = '0001') { return JSON.parse(run(root, 'inspect', id)); }

/**
 * Given：项目目录只有 memory store，evidence ledger 从未初始化
 * When：直接调用 appendEvent 尝试写入自动证据
 * Then：操作 fail-closed 且不会隐式创建 ledger
 * 防回归：缺失证据链被当成空文件，静默丢失评分来源
 */
test('append refuses to initialise a missing ledger', () => {
  const root = temp();
  const record = { id: '0001', type: 'fact', status: 'active', group: null, content: 'x' };
  assert.throws(() => appendEvent(root, {
    event_id: 'evt-missing-ledger', record_id: '0001', record_version: recordVersion(record),
    task_id: 'task-missing-ledger', kind: 'applied_success', source: 'automatic',
  }), /缺少 evidence ledger/);
  assert.equal(fs.existsSync(ledger(root)), false);
});

/**
 * Given：同一条合法 evidence event 在相同 record/version 上被重复提交
 * When：以同一 event_id 调用 appendEvent 两次，并提交一次冲突事件
 * Then：第二次幂等返回且派生计数仍为 1，冲突 event_id 被拒绝
 * 防回归：跨 session 重试造成重复评分或静默覆盖审计证据
 */
test('append is idempotent and rejects event-id conflicts', () => {
  const root = temp();
  initializeLedger(root);
  const record = { id: '0001', type: 'fact', status: 'active', group: null, content: 'x' };
  const version = recordVersion(record);
  const event = { event_id: 'evt-same', record_id: '0001', record_version: version, task_id: 'task-one', kind: 'human_positive', source: 'manual', observed_at: '2026-08-07T00:00:00Z' };
  const first = appendEvent(root, event);
  const second = appendEvent(root, event);
  assert.equal(first.applied, true);
  assert.equal(second.duplicate, true);
  assert.equal(inspectLedger(root).count, 1);
  assert.throws(() => appendEvent(root, { ...event, kind: 'human_negative' }), /冲突/);
});

/**
 * Given：ledger 已初始化，两个独立 Node 进程同时提交同一 event_id
 * When：并发执行 appendEvent
 * Then：只有一个事件落盘，另一进程得到幂等结果
 * 防回归：文件追加竞态造成重复生效或损坏 JSONL
 */
test('concurrent processes serialize one event', async () => {
  const root = temp();
  initializeLedger(root);
  const record = { id: '0001', type: 'fact', status: 'active', group: null, content: 'x' };
  const version = recordVersion(record);
  const modulePath = new URL('../scripts/evidence-ledger.mjs', import.meta.url).href;
  const code = `import { appendEvent } from ${JSON.stringify(modulePath)}; const root=process.argv[1]; const result=appendEvent(root, {event_id:'evt-concurrent',record_id:'0001',record_version:${JSON.stringify(version)},task_id:'task-concurrent',kind:'human_positive',source:'manual',observed_at:'2026-08-07T00:00:00Z'}); console.log(JSON.stringify(result));`;
  const invoke = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, root], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => status === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
  const results = await Promise.all([invoke(), invoke()]);
  assert.equal(results.filter((item) => item.applied).length, 1);
  assert.equal(results.filter((item) => item.duplicate).length, 1);
  assert.equal(inspectLedger(root).count, 1);
});

/**
 * Given：一个 active 记录和空 ledger
 * When：通过旧 score +1/-1 CLI 写入人工评分
 * Then：inspect 与 memory.md 的兼容字段均由 ledger 投影为 1/1，事件 source/kind 可审计
 * 防回归：旧 CLI 直接改计数而绕过 append-only 证据链
 */
test('manual score writes ledger events and projects compatibility fields', () => {
  const root = temp(); init(root); add(root);
  run(root, 'score', '0001', '+1'); run(root, 'score', '0001', '-1');
  const record = inspect(root);
  assert.equal(record.positive, 1); assert.equal(record.negative, 1); assert.equal(record.event_count, 2);
  const events = JSON.parse(run(root, 'evidence', 'inspect')).events;
  assert.deepEqual(events.map((event) => [event.kind, event.source]), [['human_positive', 'manual'], ['human_negative', 'manual']]);
  assert.match(fs.readFileSync(memory(root), 'utf8'), /positive="1" negative="1"/);
});

/**
 * Given：旧 record/version 已有成功证据
 * When：更新正文生成新 record_version
 * Then：旧事件仍可 inspect，但新版本投影不继承旧分数
 * 防回归：内容变化后旧成功历史错误提升新结论可信度
 */
test('record versions isolate old evidence after update', () => {
  const root = temp(); init(root); add(root, 'old content'); run(root, 'score', '0001', '+1');
  const oldVersion = inspect(root).record_version;
  run(root, 'update', '0001', '--content-file', body(root, 'new.txt', 'new content'));
  const current = inspect(root);
  assert.notEqual(current.record_version, oldVersion);
  assert.equal(current.positive, 0); assert.equal(current.negative, 0); assert.equal(current.event_count, 0);
  const history = JSON.parse(run(root, 'evidence', 'inspect')).events;
  assert.equal(history.length, 1); assert.equal(history[0].record_version, oldVersion);
});

/**
 * Given：新初始化库、截断 ledger、以及重复 event_id 冲突 ledger
 * When：分别执行 validate/read/score
 * Then：缺失、截断和冲突均 fail-closed，不继续读取或评分
 * 防回归：不完整证据被当成空 ledger，造成静默丢分或错误自动写入
 */
test('missing, truncated, and conflicting ledgers fail closed', () => {
  const missing = temp(); init(missing); add(missing); fs.unlinkSync(ledger(missing));
  runFail(missing, 'validate'); runFail(missing, 'read'); runFail(missing, 'score', '0001', '+1');

  const truncated = temp(); init(truncated); fs.writeFileSync(ledger(truncated), '{"schema_version":1');
  runFail(truncated, 'validate'); runFail(truncated, 'evidence', 'inspect');

  const conflict = temp(); init(conflict); add(conflict); run(conflict, 'score', '0001', '+1');
  const first = JSON.parse(run(conflict, 'evidence', 'inspect')).events[0];
  fs.appendFileSync(ledger(conflict), `${JSON.stringify({ ...first, kind: 'human_negative' })}\n`);
  runFail(conflict, 'validate'); runFail(conflict, 'inspect', '0001');
});

/**
 * Given：旧 memory.md 只有兼容 positive/negative 计数，ledger 为空
 * When：执行 evidence migrate
 * Then：历史计数转换为可追溯 migration 事件且迁移可重复执行
 * 防回归：迁移丢失历史评分或重复运行不断增加分数
 */
test('legacy score migration is idempotent', () => {
  const root = temp(); init(root);
  fs.writeFileSync(memory(root), '<!-- <psm-store version="1" next_id="0002" group_dimension="" /> -->\n<!-- <psm id="0001" type="fact" status="active" positive="2" negative="1" created_at="2026-08-05T00:00:00Z" last_scored_at="2026-08-06T00:00:00Z" /> -->\nlegacy\n');
  const first = JSON.parse(run(root, 'evidence', 'migrate'));
  const second = JSON.parse(run(root, 'evidence', 'migrate'));
  assert.equal(first.migrated, 3); assert.equal(second.migrated, 0);
  assert.equal(inspect(root).positive, 2); assert.equal(inspect(root).negative, 1);
  assert.equal(validateLedger(root).valid, true);
});
