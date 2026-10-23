import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentContractErrors } from '../scripts/memory-store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../scripts/memory.mjs');
const run = (root, ...argv) => execFileSync(process.execPath, [cli, '--project-root', root, ...argv], { encoding: 'utf8', env: { ...process.env, PSM_QUIET: '1' } });
const tempRoots = new Set();
const temp = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-contract-'));
  tempRoots.add(root);
  return root;
};
afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots.clear();
});
const memory = (root) => path.join(root, '.project-self-memory', 'memory.md');
const ledger = (root) => path.join(root, '.project-self-memory', 'evidence.jsonl');
const store = (next = '0001') => `<!-- <psm-store version="1" next_id="${next}" group_dimension="" /> -->\n`;
const record = (id, content, status = 'active') => `<!-- <psm id="${id}" type="fact" status="${status}" positive="0" negative="0" created_at="2026-08-05T00:00:00Z" last_scored_at="" /> -->\n${content}\n`;
const body = (root, value) => { const file = path.join(root, 'content.txt'); fs.writeFileSync(file, value); return file; };
function init(root) { run(root, 'init'); }

/**
 * Given：单行契约的各种确定性输入
 * When：调用共享校验函数
 * Then：内部换行、CRLF、Unicode 行/段分隔符、行首标题/列表/围栏与结构标记被逐条拒绝；合法单行通过
 * 防回归：CLI 与查看器各自实现校验造成行为漂移，或把语义判断混入结构校验
 */
test('shared content contract rejects structural violations deterministically', () => {
  for (const content of [
    '第一行\n第二行',
    '第一行\r\n第二行',
    '第一行 第二行',
    '第一行 第二行',
    '## 标题式结论',
    '- 列表式结论',
    '1. 编号式结论',
    '```bash',
    '<!-- <psm id="0009" /> -->',
    '   ',
    null,
  ]) {
    assert.ok(contentContractErrors(content).length > 0, JSON.stringify(content));
  }
  assert.deepEqual(contentContractErrors('连接失败时，重试一次；连续失败三次后升级。'), []);
  assert.deepEqual(contentContractErrors('部署前必须运行 `npm test`，见 [docs](https://example.com)。'), []);
});

/**
 * Given：新初始化的库
 * When：add 提交包含各类结构违规的正文
 * Then：全部退出非零并报单行契约错误，memory.md 逐字节不变
 * 防回归：不合格正文经 add 静默入库并在再序列化时破坏其他记录
 */
test('add rejects contract-violating bodies without touching the store', () => {
  const root = temp(); init(root);
  const before = fs.readFileSync(memory(root));
  for (const content of ['第一行\n第二行', '## 标题', '<!-- <psm id="0009" /> -->', '第一行 第二行']) {
    assert.throws(() => run(root, 'add', '--type', 'fact', '--content-file', body(root, content)), /单行契约/, content);
  }
  assert.deepEqual(fs.readFileSync(memory(root)), before);
});

/**
 * Given：内容文件末尾带单个换行
 * When：add 提交该文件
 * Then：外围换行被去除，存储正文为单行
 * 防回归：把文本文件的末尾换行当作内部换行拒绝，误伤正常编辑器输出
 */
test('add strips the trailing newline of content files', () => {
  const root = temp(); init(root);
  run(root, 'add', '--type', 'fact', '--content-file', body(root, '连接失败时，重试一次。\n'));
  assert.equal(JSON.parse(run(root, 'inspect', '0001')).content, '连接失败时，重试一次。');
});

/**
 * Given：库中有一条历史多行记录
 * When：update 提交新的多行正文
 * Then：拒绝且账本与 memory.md 都不变（校验先于账本副作用）
 * 防回归：不合格正文在校验前追加账本事件或备份，留下部分提交
 */
test('update rejects new multiline content before any ledger side effect', () => {
  const root = temp(); init(root);
  fs.writeFileSync(memory(root), store('0002') + record('0001', '历史第一行\n历史第二行'));
  const beforeMemory = fs.readFileSync(memory(root));
  const beforeLedger = fs.readFileSync(ledger(root));
  // 拒绝发生在任何持久化副作用之前：memory.md 与 evidence.jsonl 逐字节不变。
  assert.throws(() => run(root, 'update', '0001', '--content-file', body(root, '新一行\n又一行')), /单行契约/);
  assert.deepEqual(fs.readFileSync(memory(root)), beforeMemory);
  assert.deepEqual(fs.readFileSync(ledger(root)), beforeLedger);
  // 用一次 score 建立非空账本基线，再验证带账本副作用的 --keep-score 拒绝后两者都不变。
  run(root, 'score', '0001', '+1');
  const memoryAtScore = fs.readFileSync(memory(root));
  const ledgerAtScore = fs.readFileSync(ledger(root));
  const eventsBefore = JSON.parse(run(root, 'evidence', 'inspect')).events.length;
  assert.throws(() => run(root, 'update', '0001', '--keep-score', '--content-file', body(root, '新一行\n又一行')), /单行契约/);
  assert.equal(JSON.parse(run(root, 'evidence', 'inspect')).events.length, eventsBefore);
  assert.deepEqual(fs.readFileSync(memory(root)), memoryAtScore);
  assert.deepEqual(fs.readFileSync(ledger(root)), ledgerAtScore);
});

/**
 * Given：历史多行记录与与磁盘完全相同的正文提交
 * When：update 该记录（no-op 正文）
 * Then：不触发单行契约，命令成功，memory.md 逐字节不变
 * 防回归：元数据维护或 no-op 被强制重写历史正文
 */
test('update with unchanged legacy multiline content stays a no-op', () => {
  const raw = store('0002') + record('0001', '历史第一行\n历史第二行');
  const root = temp(); init(root);
  fs.writeFileSync(memory(root), raw);
  run(root, 'update', '0001', '--content-file', body(root, '历史第一行\n历史第二行'));
  // no-op 重序列化会补齐分隔空行；断言正文与元数据未变即可，不要求字节级等于原始 fixture。
  const after = fs.readFileSync(memory(root), 'utf8');
  assert.match(after, /历史第一行\n历史第二行/);
  assert.match(after, /positive="0" negative="0"/);
  assert.match(after, /next_id="0002"/);
});

/**
 * Given：两条记录且 merge 计划携带新的多行正文
 * When：merge 执行
 * Then：拒绝且 merge_lineage 事件不落盘，两条记录原样保留
 * 防回归：校验失败后账本已追加谱系事件，形成部分提交
 */
test('merge rejects invalid new content before appending lineage', () => {
  const raw = store('0003') + record('0001', '甲') + record('0002', '乙');
  const root = temp(); init(root);
  fs.writeFileSync(memory(root), raw);
  assert.throws(() => run(root, 'merge', '--keep', '0001', '--remove', '0002', '--content-file', body(root, '合并\n换行')), /单行契约/);
  assert.equal(fs.readFileSync(memory(root), 'utf8'), raw);
  assert.equal(JSON.parse(run(root, 'evidence', 'inspect')).events.length, 0);
});

/**
 * Given：历史多行记录继续存在
 * When：read/inspect 读取，并新增一条合格单行记录
 * Then：旧记录照常可读且字节不变，新记录以单行入库
 * 防回归：新校验把全库读取准入收紧，或写新记录时顺手格式化旧记录
 */
test('legacy multiline records stay readable and untouched by new writes', () => {
  const raw = store('0002') + record('0001', '历史第一行\n\n- 历史列表\n');
  const root = temp(); init(root);
  fs.writeFileSync(memory(root), raw);
  const out = run(root, 'read');
  assert.match(out, /历史第一行/);
  assert.equal(JSON.parse(run(root, 'inspect', '0001')).content, '历史第一行\n\n- 历史列表');
  run(root, 'add', '--type', 'fact', '--content-file', body(root, '新单行结论'));
  const after = fs.readFileSync(memory(root), 'utf8');
  assert.match(after, /历史第一行\n\n- 历史列表/);
  assert.match(after, /psm id="0002"[\s\S]*?-->\n新单行结论/);
  assert.match(after, /next_id="0003"/);
});

/**
 * Given：legacy 迁移计划同时包含多行与单行条目
 * When：legacy migrate 执行
 * Then：多行条目 ok:false 且原因指向单行契约；单行条目正常迁移
 * 防回归：迁移入口绕过正文契约，把多行 Markdown 批量带入结构化库
 */
test('legacy migrate applies the contract per plan item', () => {
  const root = temp(); init(root);
  fs.mkdirSync(path.join(root, 'self-memory'), { recursive: true });
  fs.writeFileSync(path.join(root, 'self-memory', 'memory.md'), '多行历史\n第二行\r\n\r\n单行历史\r\n');
  const scan = JSON.parse(run(root, 'legacy', 'scan'));
  assert.equal(scan.items.length, 2);
  const plan = path.join(root, 'plan.json');
  fs.writeFileSync(plan, JSON.stringify({ snapshot: scan.snapshot, items: [
    { temporary_id: 'U001', source_hash: scan.items[0].source_hash, type: 'fact', content: '多行历史\n第二行' },
    { temporary_id: 'U002', source_hash: scan.items[1].source_hash, type: 'fact', content: '单行历史' },
  ] }));
  const result = JSON.parse(run(root, 'legacy', 'migrate', '--plan-file', plan));
  assert.equal(result[0].ok, false);
  assert.match(result[0].reason, /单行契约/);
  assert.equal(result[1].ok, true);
  const stored = JSON.parse(run(root, 'inspect', result[1].id));
  assert.equal(stored.content, '单行历史');
});

/**
 * Given：历史多行记录
 * When：仅用 status 命令做元数据变更
 * Then：成功且正文保持多行
 * 防回归：状态类写路径被误接入正文契约
 */
test('metadata-only status change keeps legacy multiline content', () => {
  const raw = store('0002') + record('0001', '历史第一行\n历史第二行');
  const root = temp(); init(root);
  fs.writeFileSync(memory(root), raw);
  run(root, 'status', '0001', 'review');
  const after = fs.readFileSync(memory(root), 'utf8');
  assert.match(after, /历史第一行\n历史第二行/);
  assert.match(after, /status="review"/);
});
