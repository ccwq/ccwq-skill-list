import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/memory.mjs');
const run = (root, ...argv) => execFileSync(process.execPath, [cli, '--project-root', root, ...argv], { encoding: 'utf8' });
const runFail = (root, ...argv) => {
  try {
    execFileSync(process.execPath, [cli, '--project-root', root, ...argv], { encoding: 'utf8', stdio: 'pipe' });
    return null;
  } catch (error) {
    return `${error.stderr || ''}${error.stdout || ''}`;
  }
};
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psm-cache-'));
const cacheFile = (root) => path.join(root, '.project-self-memory', 'cache.jsonl');
const memoryFile = (root) => path.join(root, '.project-self-memory', 'memory.md');
const write = (root, name, text) => {
  const file = path.join(root, name);
  fs.writeFileSync(file, text);
  return file;
};

function addRecord(root, content, type = 'fact') {
  const body = write(root, 'body.txt', content);
  return run(root, 'add', '--type', type, '--content-file', body).trim();
}

/**
 * Given：新建项目已 init，cache 里追加一条 add 候选
 * When：执行 cache list 与 cache show
 * Then：list 按组返回该条目，show 返回同一条目及内联 evidence
 * 防回归：候选写入后无法被 -c 流程读到，或 show 与 list 形状不一致
 */
test('cache add makes the candidate visible to list and show', () => {
  const root = temp();
  run(root, 'init');
  const body = write(root, 'body.txt', 'CACHE_LIST_SENTINEL_1a2b');
  const added = JSON.parse(run(root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', body));
  assert.match(added.event_id, /^[a-f0-9]{32}$/);
  assert.equal(added.status, 'pending');

  const listed = JSON.parse(run(root, 'cache', 'list'));
  assert.equal(listed.count, 1);
  assert.equal(listed.groups.length, 1);
  assert.equal(listed.groups[0].kind, 'new');
  assert.equal(listed.groups[0].entries[0].event_id, added.event_id);
  assert.equal(listed.groups[0].entries[0].payload.content, 'CACHE_LIST_SENTINEL_1a2b');
  assert.equal(listed.groups[0].entries[0].payload.record_type, 'fact');

  const shown = JSON.parse(run(root, 'cache', 'show', added.event_id));
  assert.equal(shown.event_id, added.event_id);
  assert.equal(shown.status, 'pending');
  assert.equal(typeof shown.evidence, 'object');
});

/**
 * Given：同一会话对同一内容重复追加候选
 * When：执行两次内容与 source 相同的 cache add
 * Then：event_id 相同、第二次报告 duplicate，cache 里只有一条
 * 防回归：重复追加在 cache 里堆出同 id 多条，-c 时重复处理
 */
test('cache add is idempotent for the same operation inside one session', () => {
  const root = temp();
  run(root, 'init');
  const body = write(root, 'body.txt', 'CACHE_IDEMPOTENT_SENTINEL_3c4d');
  const first = JSON.parse(run(root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', body, '--source', 'task-a'));
  const second = JSON.parse(run(root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', body, '--source', 'task-a'));
  assert.equal(second.event_id, first.event_id);
  assert.equal(second.duplicate, true);
  assert.equal(JSON.parse(run(root, 'cache', 'list')).count, 1);
});

/**
 * Given：一条待写入的新增候选
 * When：执行 cache apply --decision write
 * Then：记忆库出现该记录，条目转为 applied，cache 保留审计痕
 * 防回归：写入后条目被删除，或状态仍停在 pending 导致重复落库
 */
test('cache apply writes the candidate into the library and marks it applied', () => {
  const root = temp();
  run(root, 'init');
  const body = write(root, 'body.txt', 'CACHE_APPLY_SENTINEL_5e6f');
  const added = JSON.parse(run(root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', body));
  const applied = JSON.parse(run(root, 'cache', 'apply', '--id', added.event_id, '--decision', 'write'));
  assert.equal(applied.status, 'applied');
  assert.match(fs.readFileSync(memoryFile(root), 'utf8'), /CACHE_APPLY_SENTINEL_5e6f/);
  const after = JSON.parse(run(root, 'cache', 'show', added.event_id));
  assert.equal(after.status, 'applied');
  assert.equal(JSON.parse(run(root, 'cache', 'list')).count, 0);
});

/**
 * Given：一条待写入的新增候选
 * When：执行 cache apply --decision discard
 * Then：记忆库不变，条目转为 discarded
 * 防回归：丢弃路径仍然写库，或状态未标记导致下次被重复处理
 */
test('cache apply discard leaves the library untouched', () => {
  const root = temp();
  run(root, 'init');
  const before = fs.readFileSync(memoryFile(root), 'utf8');
  const body = write(root, 'body.txt', 'CACHE_DISCARD_SENTINEL_7a8b');
  const added = JSON.parse(run(root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', body));
  const discarded = JSON.parse(run(root, 'cache', 'apply', '--id', added.event_id, '--decision', 'discard'));
  assert.equal(discarded.status, 'discarded');
  assert.equal(fs.readFileSync(memoryFile(root), 'utf8'), before);
  assert.equal(JSON.parse(run(root, 'cache', 'show', added.event_id)).status, 'discarded');
});

/**
 * Given：目标记录在候选暂存后被修改
 * When：对该候选执行 cache apply --decision write
 * Then：拒绝并给出 PSM_CONFLICT，条目保持 pending，记忆库不被覆盖
 * 防回归：失效候选直接覆盖用户已改过的正文
 */
test('cache apply refuses a stale target and keeps the entry pending', () => {
  const root = temp();
  run(root, 'init');
  const id = addRecord(root, 'CACHE_STALE_ORIGINAL_SENTINEL_9c0d');
  const body = write(root, 'body.txt', 'CACHE_STALE_PROPOSED_SENTINEL_9c0d');
  const added = JSON.parse(run(root, 'cache', 'add', '--op', 'update', '--target', id, '--content-file', body));
  const changed = write(root, 'changed.txt', 'CACHE_STALE_CHANGED_SENTINEL_9c0d');
  run(root, 'update', id, '--content-file', changed);

  const failure = runFail(root, 'cache', 'apply', '--id', added.event_id, '--decision', 'write');
  assert.match(failure, /PSM_CONFLICT/);
  assert.equal(JSON.parse(run(root, 'cache', 'show', added.event_id)).status, 'pending');
  assert.match(fs.readFileSync(memoryFile(root), 'utf8'), /CACHE_STALE_CHANGED_SENTINEL_9c0d/);
  assert.doesNotMatch(fs.readFileSync(memoryFile(root), 'utf8'), /CACHE_STALE_PROPOSED_SENTINEL_9c0d/);
});

/**
 * Given：目标记录在候选暂存后被修改
 * When：执行 cache list
 * Then：该条目被标记 stale，且 list 报告 pending 数量不变
 * 防回归：失效候选被静默跳过，用户看不到自己曾想保存的结论
 */
test('cache list marks entries whose target changed as stale', () => {
  const root = temp();
  run(root, 'init');
  const id = addRecord(root, 'CACHE_STALE_LIST_ORIGINAL_b1c2');
  const body = write(root, 'body.txt', 'CACHE_STALE_LIST_PROPOSED_b1c2');
  const added = JSON.parse(run(root, 'cache', 'add', '--op', 'update', '--target', id, '--content-file', body));
  const changed = write(root, 'changed.txt', 'CACHE_STALE_LIST_CHANGED_b1c2');
  run(root, 'update', id, '--content-file', changed);

  const listed = JSON.parse(run(root, 'cache', 'list'));
  assert.equal(listed.count, 1);
  const group = listed.groups.find((item) => item.refid === id);
  assert.ok(group, '失效候选仍需出现在分组里');
  assert.equal(group.kind, 'stale');
  assert.equal(group.entries[0].stale, true);
  assert.equal(group.current.content, 'CACHE_STALE_LIST_CHANGED_b1c2');
});

/**
 * Given：目标记录在候选暂存后被删除
 * When：执行 cache apply --decision write
 * Then：拒绝并给出 PSM_CONFLICT，条目保持 pending
 * 防回归：目标已不存在时写入凭空造出孤立记录
 */
test('cache apply refuses a deleted target', () => {
  const root = temp();
  run(root, 'init');
  const id = addRecord(root, 'CACHE_DELETED_TARGET_c3d4');
  const body = write(root, 'body.txt', 'CACHE_DELETED_PROPOSED_c3d4');
  const added = JSON.parse(run(root, 'cache', 'add', '--op', 'update', '--target', id, '--content-file', body));
  run(root, 'delete', '--ids', id);

  const failure = runFail(root, 'cache', 'apply', '--id', added.event_id, '--decision', 'write');
  assert.match(failure, /PSM_CONFLICT/);
  assert.equal(JSON.parse(run(root, 'cache', 'show', added.event_id)).status, 'pending');
});

/**
 * Given：候选正文是多行文本，违反单行契约
 * When：执行 cache add
 * Then：拒绝写入，cache 文件不产生任何条目
 * 防回归：违反契约的正文进入 cache，直到落库时才暴露
 */
test('cache add rejects content that violates the single-line contract', () => {
  const root = temp();
  run(root, 'init');
  const body = write(root, 'body.txt', '第一行\n第二行');
  const failure = runFail(root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', body);
  assert.match(failure, /PSM_CONTRACT/);
  assert.equal(fs.existsSync(cacheFile(root)), false);
});

/**
 * Given：同一记录同时暂存 +1 与 -1 两条投票候选
 * When：执行 cache list
 * Then：两条进入同一分组且分组标记为冲突
 * 防回归：矛盾投票被拆散，用户无法一次看清取舍
 */
test('cache list groups contradictory votes on one record as a conflict', () => {
  const root = temp();
  run(root, 'init');
  const id = addRecord(root, 'CACHE_CONFLICT_TARGET_d5e6');
  run(root, 'cache', 'add', '--op', '+1', '--target', id, '--source', 'task-a');
  run(root, 'cache', 'add', '--op', '-1', '--target', id, '--source', 'task-b');

  const listed = JSON.parse(run(root, 'cache', 'list'));
  assert.equal(listed.count, 2);
  assert.equal(listed.groups.length, 1);
  assert.equal(listed.groups[0].refid, id);
  assert.equal(listed.groups[0].conflict, true);
  assert.deepEqual(listed.groups[0].entries.map((entry) => entry.type).sort(), ['+1', '-1']);
});

/**
 * Given：待写入的 +1 投票候选
 * When：执行 cache apply --decision write
 * Then：证据账本新增一条正向事件且记录分值上升
 * 防回归：投票落库路径绕过账本，评分投影不更新
 */
test('cache apply writes a vote into the evidence ledger', () => {
  const root = temp();
  run(root, 'init');
  const id = addRecord(root, 'CACHE_VOTE_TARGET_e7f8');
  const added = JSON.parse(run(root, 'cache', 'add', '--op', '+1', '--target', id, '--source', 'task-a'));
  const applied = JSON.parse(run(root, 'cache', 'apply', '--id', added.event_id, '--decision', 'write'));
  assert.equal(applied.status, 'applied');
  const record = JSON.parse(run(root, 'inspect', id));
  assert.equal(record.positive, 1);
  const events = JSON.parse(run(root, 'evidence', 'inspect')).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].record_id, id);
});

/**
 * Given：一条暂存的修改候选，用户决定改写后写入
 * When：cache apply --decision write 附带改写后的 --content-file
 * Then：记忆库写入改写版本，条目转为 applied
 * 防回归：改写后的正文被忽略，或修改类无法经用户讨论后落库
 */
test('cache apply writes the rewritten body when one is supplied', () => {
  const root = temp();
  run(root, 'init');
  const id = addRecord(root, 'CACHE_REWRITE_ORIGINAL_a2b3');
  const proposed = write(root, 'proposed.txt', 'CACHE_REWRITE_PROPOSED_a2b3');
  const added = JSON.parse(run(root, 'cache', 'add', '--op', 'update', '--target', id, '--content-file', proposed));
  const rewritten = write(root, 'rewritten.txt', 'CACHE_REWRITE_FINAL_a2b3');
  const applied = JSON.parse(run(root, 'cache', 'apply', '--id', added.event_id, '--decision', 'write', '--content-file', rewritten));
  assert.equal(applied.status, 'applied');
  const memory = fs.readFileSync(memoryFile(root), 'utf8');
  assert.match(memory, /CACHE_REWRITE_FINAL_a2b3/);
  assert.doesNotMatch(memory, /CACHE_REWRITE_PROPOSED_a2b3/);
});

/**
 * Given：一条暂存的修改候选，用户改写后的正文违反单行契约
 * When：cache apply --decision write 附带多行 --content-file
 * Then：拒绝并给出 PSM_CONTRACT，记忆库不变且不产生备份
 * 防回归：多行正文绕过契约进入记忆库
 */
test('cache apply rejects rewritten content that violates the single-line contract', () => {
  const root = temp();
  run(root, 'init');
  const id = addRecord(root, 'CACHE_CONTRACT_ORIGINAL_b3c4');
  const proposed = write(root, 'proposed.txt', 'CACHE_CONTRACT_PROPOSED_b3c4');
  const added = JSON.parse(run(root, 'cache', 'add', '--op', 'update', '--target', id, '--content-file', proposed));
  const before = fs.readFileSync(memoryFile(root), 'utf8');
  const backups = path.join(root, '.project-self-memory', 'backups');
  const backupsBefore = fs.existsSync(backups) ? fs.readdirSync(backups).length : 0;
  const rewritten = write(root, 'rewritten.txt', '第一行\n第二行');
  const failure = runFail(root, 'cache', 'apply', '--id', added.event_id, '--decision', 'write', '--content-file', rewritten);
  assert.match(failure, /PSM_CONTRACT/);
  assert.equal(fs.readFileSync(memoryFile(root), 'utf8'), before);
  const backupsAfter = fs.existsSync(backups) ? fs.readdirSync(backups).length : 0;
  assert.equal(backupsAfter, backupsBefore, '契约失败不得产生备份');
  assert.equal(JSON.parse(run(root, 'cache', 'show', added.event_id)).status, 'pending');
});

/**
 * Given：cache show 展示的候选
 * When：查看带目标记录的候选
 * Then：条目带暂存时的原基准正文（base_content）与目标记录现状，供展示 diff
 * 防回归：修改类候选缺少原正文，用户无法审阅将要覆盖的内容
 */
test('cache show exposes the current target body for diffing', () => {
  const root = temp();
  run(root, 'init');
  const id = addRecord(root, 'CACHE_DIFF_CURRENT_c4d5');
  const proposed = write(root, 'proposed.txt', 'CACHE_DIFF_PROPOSED_c4d5');
  const added = JSON.parse(run(root, 'cache', 'add', '--op', 'update', '--target', id, '--content-file', proposed));
  const shown = JSON.parse(run(root, 'cache', 'show', added.event_id));
  assert.equal(shown.current.exists, true);
  assert.equal(shown.current.content, 'CACHE_DIFF_CURRENT_c4d5');
  assert.equal(shown.payload.content, 'CACHE_DIFF_PROPOSED_c4d5');
  assert.equal(shown.base_content, 'CACHE_DIFF_CURRENT_c4d5');
});

/**
 * Given：同一记录被暂存多条修改候选
 * When：执行 cache list
 * Then：多条修改归入同一分组并标记为冲突
 * 防回归：多条修改散在不同组，用户无法一次看清取舍
 */
test('cache list groups multiple updates on one record as a conflict', () => {
  const root = temp();
  run(root, 'init');
  const id = addRecord(root, 'CACHE_MULTI_UPDATE_TARGET_d6e7');
  const first = write(root, 'first.txt', 'CACHE_MULTI_UPDATE_FIRST_d6e7');
  const second = write(root, 'second.txt', 'CACHE_MULTI_UPDATE_SECOND_d6e7');
  run(root, 'cache', 'add', '--op', 'update', '--target', id, '--content-file', first);
  run(root, 'cache', 'add', '--op', 'update', '--target', id, '--content-file', second);

  const listed = JSON.parse(run(root, 'cache', 'list'));
  assert.equal(listed.count, 2);
  assert.equal(listed.groups.length, 1);
  assert.equal(listed.groups[0].refid, id);
  assert.equal(listed.groups[0].conflict, true);
  assert.equal(listed.groups[0].entries.length, 2);
});

/**
 * Given：cache 文件里的一条候选正文被改成多行
 * When：执行 cache apply --decision write
 * Then：落库那一刻的契约复检拒绝写入，记忆库不变
 * 防回归：暂存时的校验通过后，条目被改写就绕过契约进入记忆库
 */
test('cache apply re-checks the contract at landing time', () => {
  const root = temp();
  run(root, 'init');
  const body = write(root, 'body.txt', 'CACHE_RECHECK_ORIGINAL_d6e7');
  const added = JSON.parse(run(root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', body));
  const before = fs.readFileSync(memoryFile(root), 'utf8');
  const raw = fs.readFileSync(cacheFile(root), 'utf8').replace('CACHE_RECHECK_ORIGINAL_d6e7', '第一行\\n第二行');
  fs.writeFileSync(cacheFile(root), raw);

  const failure = runFail(root, 'cache', 'apply', '--id', added.event_id, '--decision', 'write');
  assert.match(failure, /PSM_CONTRACT/);
  assert.equal(fs.readFileSync(memoryFile(root), 'utf8'), before);
});

/**
 * Given：一条与类型不自洽的候选（如 add 却带目标记录）
 * When：执行 cache add
 * Then：写入前被拒绝，cache 保持可读，不留下半条坏记录
 * 防回归：坏条目落盘后让后续 list/show/apply 全部失败，cache 不可自愈
 */
test('cache add rejects an entry that does not match its own type', () => {
  const root = temp();
  run(root, 'init');
  addRecord(root, 'CACHE_POISON_TARGET_e8f9');
  const body = write(root, 'body.txt', 'CACHE_POISON_BODY_e8f9');
  const failure = runFail(root, 'cache', 'add', '--op', 'add', '--target', '0001', '--record-type', 'fact', '--content-file', body);
  assert.match(failure, /PSM_ERROR/);
  assert.equal(JSON.parse(run(root, 'cache', 'list')).count, 0);
});

/**
 * Given：两个会话各自暂存同一条新增候选
 * When：分别以不同 --source 追加
 * Then：两条都留在 cache 里（重复新增原样留存，交由 -c 取舍），不被静默合并
 * 防回归：跨会话的同内容候选被去重掉一条，用户少看到一条待办
 */
test('the same candidate from two sessions stays as two entries', () => {
  const root = temp();
  run(root, 'init');
  const body = write(root, 'body.txt', 'CACHE_CROSS_SESSION_f0a1');
  run(root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', body, '--source', 'task-a');
  run(root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', body, '--source', 'task-b');
  assert.equal(JSON.parse(run(root, 'cache', 'list')).count, 2);
});

/**
 * Given：cache 里有一条 pending 与一条已 applied 的条目
 * When：执行 cache prune
 * Then：只清掉已处理条目，pending 条目保留
 * 防回归：prune 清掉未处理候选，用户攒下的结论被静默丢弃
 */
test('cache prune removes processed entries and keeps pending ones', () => {
  const root = temp();
  run(root, 'init');
  const kept = write(root, 'kept.txt', 'CACHE_PRUNE_KEPT_f9a0');
  const keptEntry = JSON.parse(run(root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', kept));
  const pruned = write(root, 'pruned.txt', 'CACHE_PRUNE_PRUNED_f9a0');
  const prunedEntry = JSON.parse(run(root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', pruned));
  run(root, 'cache', 'apply', '--id', prunedEntry.event_id, '--decision', 'discard');

  const result = JSON.parse(run(root, 'cache', 'prune'));
  assert.equal(result.removed, 1);
  assert.deepEqual(result.removed_ids, [prunedEntry.event_id]);
  assert.equal(JSON.parse(run(root, 'cache', 'list')).groups[0].entries[0].event_id, keptEntry.event_id);
});

/**
 * Given：init 后的项目
 * When：检查项目根 .gitignore
 * Then：cache 文件与锁文件被忽略，暂存内容不入版本库
 * 防回归：cache 内容被提交进仓库
 */
test('init ignores the cache file and its lock in git', () => {
  const root = temp();
  run(root, 'init');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /\.project-self-memory\/cache\.jsonl/);
  assert.match(ignore, /\.project-self-memory\/cache\.lock/);
});

/**
 * Given：两个并发进程同时往 cache 追加候选
 * When：两个 cache add 并行执行
 * Then：两条候选都在 cache 里，没有互相覆盖
 * 防回归：并发追加丢条目，用户攒下的候选无声消失
 */
test('concurrent cache adds do not lose entries', () => {
  const root = temp();
  run(root, 'init');
  const first = write(root, 'a.txt', 'CACHE_CONCURRENT_A_a1b2');
  const second = write(root, 'b.txt', 'CACHE_CONCURRENT_B_a1b2');
  const spawnAdd = (file, source) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      [cli, '--project-root', root, 'cache', 'add', '--op', 'add', '--record-type', 'fact', '--content-file', file, '--source', source],
      { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
  return Promise.all([spawnAdd(first, 'task-a'), spawnAdd(second, 'task-b')]).then(() => {
    const listed = JSON.parse(run(root, 'cache', 'list'));
    assert.equal(listed.count, 2);
  });
});
