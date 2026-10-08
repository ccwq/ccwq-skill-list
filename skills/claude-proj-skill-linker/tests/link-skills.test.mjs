import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, validateSkillName, normalizeProjectRoot } from '../scripts/link-skills.mjs';

async function makeTempProject(t, layout = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linker-test-'));
  t.after(async () => {
    await fsp.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const agents = path.join(root, '.agents', 'skills');
  const claude = path.join(root, '.claude', 'skills');
  await fsp.mkdir(agents, { recursive: true });
  await fsp.mkdir(claude, { recursive: true });
  for (const [name, spec] of Object.entries(layout)) {
    await materialize(agents, claude, name, spec);
  }
  return { root, agents, claude };
}

// 目录链接 fixture：Windows 用免特权的 junction，POSIX 用目录 symlink。
async function linkDir(target, linkPath) {
  if (process.platform === 'win32') {
    await fsp.symlink(path.resolve(target), linkPath, 'junction');
  } else {
    await fsp.symlink(path.resolve(target), linkPath, 'dir');
  }
}

async function materialize(agents, claude, name, spec) {
  const source = path.join(agents, name);
  const entry = path.join(claude, name);
  const which = spec.side === 'entry' ? entry : source;
  if (spec.type === 'skill') {
    await writeSkill(which, spec.content);
  } else if (spec.type === 'plain-dir') {
    await fsp.mkdir(which, { recursive: true });
  } else if (spec.type === 'file') {
    await fsp.mkdir(path.dirname(which), { recursive: true });
    await fsp.writeFile(which, 'data');
  } else if (spec.type === 'link') {
    await linkDir(spec.target, which);
  } else if (spec.type === 'broken-link') {
    await fsp.symlink(path.join(agents, 'does-not-exist-anywhere'), which, 'dir');
  }
}

async function writeSkill(dir, content = '---\nname: x\ndescription: test\n---\n') {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'SKILL.md'), content);
}

async function preview(root, options = {}) {
  return run({ projectRoot: root, skills: options.skills ?? [], apply: false, expect: null });
}

async function apply(root, expectDigest, options = {}) {
  return run({ projectRoot: root, skills: options.skills ?? [], apply: true, expect: expectDigest });
}

function findItem(outcome, name) {
  return outcome.report.items.find((item) => item.name === name);
}

test('rejects invalid skill names: separators, traversal, drive, reserved device', () => {
  for (const bad of ['a/b', 'a\\b', '..', '.', 'c:foo', 'con', 'NUL', 'a:b', 'name with\ttab']) {
    assert.throws(() => validateSkillName(bad), (error) => error.code === 'BAD_NAME', bad);
  }
  assert.doesNotThrow(() => validateSkillName('my-skill'));
  assert.doesNotThrow(() => validateSkillName('中文技能'));
  assert.doesNotThrow(() => validateSkillName('with space'));
});

test('rejects global and root targets as project root', () => {
  assert.throws(() => normalizeProjectRoot(path.parse(os.homedir()).root), (error) => error.code === 'BAD_ROOT');
  assert.throws(() => normalizeProjectRoot(os.homedir()), (error) => error.code === 'BAD_ROOT');
  assert.throws(() => normalizeProjectRoot(path.join(os.homedir(), '.claude')), (error) => error.code === 'BAD_ROOT');
  assert.throws(() => normalizeProjectRoot(path.join(os.homedir(), '.agents')), (error) => error.code === 'BAD_ROOT');
  assert.throws(() => normalizeProjectRoot(path.join(os.homedir(), '.claude', 'projects', 'x')), (error) => error.code === 'BAD_ROOT');
  // 大小写变体（Windows 大小写不敏感）也要拒绝。
  const upper = os.homedir().toUpperCase();
  if (upper !== os.homedir()) {
    assert.throws(() => normalizeProjectRoot(upper), (error) => error.code === 'BAD_ROOT');
  }
});

test('rejects project root whose resolved alias lands in the real global tree', async (t) => {
  // 项目根是链接、真实目标落在真实 home 的全局树内：词法检查发现不了，
  // prepareContext 必须用真实根复检拒绝。链接只读指向全局目录，不写入。
  const realClaude = path.join(os.homedir(), '.claude');
  try {
    await fsp.stat(realClaude);
  } catch {
    return; // 本机无全局 .claude 时跳过 fixture 依赖
  }
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'linker-alias-'));
  t.after(async () => {
    await fsp.rm(base, { recursive: true, force: true, maxRetries: 3 });
  });
  const alias = path.join(base, 'alias');
  try {
    await linkDir(realClaude, alias);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EEXIST'].includes(error.code)) return;
    throw error;
  }
  const { prepareContext } = await import('../scripts/link-skills.mjs');
  await assert.rejects(() => prepareContext({ projectRoot: alias }), (error) => error.code === 'BAD_ROOT');
});

test('rejects symlinked containers (.agents/.claude/skills)', async (t) => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'linker-containers-'));
  t.after(async () => {
    await fsp.rm(base, { recursive: true, force: true, maxRetries: 3 });
  });
  const outside = path.join(base, 'outside-skills');
  await writeSkill(path.join(outside, 'rogue'));

  for (const rel of ['.agents', '.claude', path.join('.agents', 'skills'), path.join('.claude', 'skills')]) {
    const root = path.join(base, `proj-${rel.replaceAll(path.sep, '-')}`);
    await fsp.mkdir(root, { recursive: true });
    const linkedPath = path.join(root, rel);
    await fsp.mkdir(path.dirname(linkedPath), { recursive: true });
    await linkDir(outside, linkedPath);
    await assert.rejects(
      () => preview(root),
      (error) => error.code === 'BAD_CONTAINER',
      rel,
    );
  }
  void outside;
});

test('preview is read-only: layout unchanged, digest reported', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {
    alpha: { type: 'skill', side: 'source' },
  });
  const before = await snapshot(root);
  const beforeContents = await snapshotContents(root);
  const outcome = await preview(root);
  const after = await snapshot(root);
  const afterContents = await snapshotContents(root);
  assert.deepEqual(after, before);
  assert.deepEqual(afterContents, beforeContents);
  assert.equal(outcome.exitCode, 0);
  assert.ok(outcome.report.digest);
  assert.equal(outcome.report.root, root);
  void agents; void claude;
});

test('valid source skill with no entry: preview proposes link, apply creates canonical entry', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {
    alpha: { type: 'skill', side: 'source' },
  });
  const first = await preview(root);
  assert.equal(findItem(first, 'alpha').action, 'link');
  const applied = await apply(root, first.report.digest);
  assert.equal(applied.exitCode, 0);
  const entry = path.join(claude, 'alpha');
  const stats = fs.lstatSync(entry);
  assert.equal(stats.isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(entry, 'SKILL.md')), true);
  void agents;
});

test('entry-only real skill: preview proposes move-and-link, apply moves and links', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {
    beta: { type: 'skill', side: 'entry' },
  });
  const first = await preview(root);
  assert.equal(findItem(first, 'beta').action, 'move-and-link');
  const applied = await apply(root, first.report.digest);
  assert.equal(applied.exitCode, 0);
  const source = path.join(agents, 'beta');
  assert.equal(fs.existsSync(path.join(source, 'SKILL.md')), true);
  const entryStats = fs.lstatSync(path.join(claude, 'beta'));
  assert.equal(entryStats.isSymbolicLink(), true);
});

test('same-name real directories on both sides: conflict, skipped, both preserved', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {
    gamma: { type: 'skill', side: 'source', content: '---\nname: s\n---\nsource' },
  });
  await writeSkill(path.join(claude, 'gamma'), '---\nname: e\n---\nentry');
  const outcome = await preview(root);
  const item = findItem(outcome, 'gamma');
  assert.equal(item.action, null);
  assert.match(item.note, /conflict/);
  assert.equal(fs.existsSync(path.join(agents, 'gamma', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(claude, 'gamma', 'SKILL.md')), true);
});

test('broken entry link: preserved and reported, not auto-fixed', async (t) => {
  const { root, claude } = await makeTempProject(t, {
    delta: { type: 'skill', side: 'source' },
  });
  await fsp.symlink(path.join(root, 'nowhere'), path.join(claude, 'delta'), 'dir');
  const outcome = await preview(root);
  const item = findItem(outcome, 'delta');
  assert.equal(item.action, null);
  assert.match(item.note, /broken link/);
  void claude;
});

test('external source link with readable SKILL.md: accepted, dependency reported, external content untouched', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {});
  const external = await fsp.mkdtemp(path.join(os.tmpdir(), 'linker-ext-'));
  t.after(async () => {
    await fsp.rm(external, { recursive: true, force: true, maxRetries: 3 });
  });
  await writeSkill(path.join(external, 'extern-skill'), '---\nname: extern-skill\n---\nEXTERNAL CONTENT');
  await linkDir(path.join(external, 'extern-skill'), path.join(agents, 'extern'));
  const beforePaths = await snapshot(external);
  const beforeContents = await snapshotContents(external);
  const first = await preview(root);
  const item = findItem(first, 'extern');
  assert.equal(item.action, 'link');
  assert.match(item.note, /external/);
  const applied = await apply(root, first.report.digest);
  assert.equal(applied.exitCode, 0);
  assert.equal(fs.existsSync(path.join(claude, 'extern', 'SKILL.md')), true);
  // 外部目标的路径与内容均未被修改
  assert.deepEqual(await snapshot(external), beforePaths);
  assert.deepEqual(await snapshotContents(external), beforeContents);
  assert.equal(
    (await fsp.readFile(path.join(external, 'extern-skill', 'SKILL.md'), 'utf8')).includes('EXTERNAL CONTENT'),
    true,
  );
});

test('canonical entry is idempotent; foreign in-project entry is reported', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {
    eps: { type: 'skill', side: 'source' },
  });
  const first = await preview(root);
  await apply(root, first.report.digest);
  const second = await preview(root);
  assert.equal(findItem(second, 'eps').action, null);
  assert.match(findItem(second, 'eps').note, /already linked correctly/);
  // 指向项目内其他位置的偏差入口
  await writeSkill(path.join(agents, 'other-place'));
  const entry = path.join(claude, 'deviated');
  await writeSkill(path.join(agents, 'deviated-real'));
  await linkDir(path.join(agents, 'deviated-real'), entry);
  await linkDir(path.join(agents, 'other-place'), path.join(claude, 'deviated2'));
  const third = await preview(root);
  const deviated = findItem(third, 'deviated');
  assert.equal(deviated.action, null);
  assert.match(deviated.note, /non-canonical|deviat|preserved/i);
});

test('plain file and dir without SKILL.md on either side: skipped', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {});
  await fsp.writeFile(path.join(agents, 'stray-file'), 'x');
  await fsp.mkdir(path.join(claude, 'plain-dir'));
  const outcome = await preview(root);
  assert.equal(findItem(outcome, 'stray-file').action, null);
  assert.equal(findItem(outcome, 'plain-dir').action, null);
  void agents; void claude;
});

test('stale digest: apply refuses when state changed after preview', async (t) => {
  const { root, agents } = await makeTempProject(t, {
    zeta: { type: 'skill', side: 'source' },
  });
  const first = await preview(root);
  // 预览后新增 skill 改变状态
  await writeSkill(path.join(agents, 'newcomer'));
  await assert.rejects(
    () => apply(root, first.report.digest),
    (error) => error.code === 'STALE',
  );
});

test('digest binds project root: same layout in another project is STALE', async (t) => {
  const a = await makeTempProject(t, { eta: { type: 'skill', side: 'source' } });
  const b = await makeTempProject(t, {});
  const first = await preview(a.root);
  await assert.rejects(
    () => apply(b.root, first.report.digest),
    (error) => error.code === 'STALE',
  );
  void a.agents;
});

test('digest binds selection: narrowing --skill after preview is STALE', async (t) => {
  const { root } = await makeTempProject(t, {
    one: { type: 'skill', side: 'source' },
    two: { type: 'skill', side: 'source' },
  });
  const full = await preview(root);
  await assert.rejects(
    () => apply(root, full.report.digest, { skills: ['one'] }),
    (error) => error.code === 'STALE',
  );
});

test('digest binds link target: retargeted link with identical action/note shape is STALE', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {});
  // 源侧 skill 通过链接接入；两个外部目标都会产生 action=link 的判定。
  const ext1 = path.join(agents, 'ext1');
  const ext2 = path.join(agents, 'ext2');
  await writeSkill(ext1, '---\nname: x\n---\nv1');
  await writeSkill(ext2, '---\nname: x\n---\nv2');
  await linkDir(ext1, path.join(claude, 'linked-skill'));
  void claude;
  // claude 侧入口是非规范链接，被保留报告（action=null），但链接真实目标进入摘要。
  const first = await preview(root);
  await fsp.rmdir(path.join(claude, 'linked-skill'));
  await linkDir(ext2, path.join(claude, 'linked-skill'));
  const second = await preview(root);
  const item1 = findItem(first, 'linked-skill');
  const item2 = findItem(second, 'linked-skill');
  assert.equal(item1.action, item2.action);
  assert.notEqual(first.report.digest, second.report.digest);
});

test('by-name selection: only chosen skills appear in items', async (t) => {
  const { root } = await makeTempProject(t, {
    one: { type: 'skill', side: 'source' },
    two: { type: 'skill', side: 'source' },
  });
  const outcome = await preview(root, { skills: ['one'] });
  const names = outcome.report.items.map((item) => item.name);
  assert.deepEqual(names.sort(), ['one']);
});

test('paths with spaces and Chinese characters work end to end', async (t) => {
  const { root, claude } = await makeTempProject(t, {
    '带 空格 技能': { type: 'skill', side: 'source' },
  });
  const first = await preview(root);
  assert.equal(findItem(first, '带 空格 技能').action, 'link');
  const applied = await apply(root, first.report.digest);
  assert.equal(applied.exitCode, 0);
  assert.equal(fs.existsSync(path.join(claude, '带 空格 技能', 'SKILL.md')), true);
});

test('move drift: source appearing after preview stops apply without touching entry', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {
    theta: { type: 'skill', side: 'entry' },
  });
  const first = await preview(root);
  // 预览后在源侧放置同名实体，摘要随之失效
  await writeSkill(path.join(agents, 'theta'));
  await assert.rejects(
    () => apply(root, first.report.digest),
    (error) => error.code === 'STALE',
  );
  // 原 entry 目录完好
  assert.equal(fs.existsSync(path.join(claude, 'theta', 'SKILL.md')), true);
});

// 注入点：指定路径的第 n 次 fs.lstatSync 调用抛 EINVAL（验证阶段失败）。
// 清理/恢复阶段的后续调用恢复真实行为，因此身份校验与恢复逻辑完整可验证。
function failLstatOnNthCall(targetPath, n) {
  let calls = 0;
  const original = fs.lstatSync;
  fs.lstatSync = function lstatSync(linkPath, ...rest) {
    const isTarget = path.resolve(String(linkPath)) === path.resolve(targetPath);
    if (isTarget) {
      calls += 1;
      if (calls === n) {
        const error = new Error(`EINVAL: injected lstat failure at ${linkPath}`);
        error.code = 'EINVAL';
        throw error;
      }
    }
    return original.call(fs, linkPath, ...rest);
  };
  return () => {
    fs.lstatSync = original;
  };
}

function failSymlinkAt(targetPath) {
  const original = fs.symlinkSync;
  fs.symlinkSync = function symlinkSync(target, linkPath, ...rest) {
    if (path.resolve(String(linkPath)) === path.resolve(targetPath)) {
      const error = new Error(`EPERM: injected symlink failure at ${linkPath}`);
      error.code = 'EPERM';
      throw error;
    }
    return original.call(fs, target, linkPath, ...rest);
  };
  return () => {
    fs.symlinkSync = original;
  };
}

test('link verify failure: entry created by this step is cleaned up, item fails cleanly', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {
    iota: { type: 'skill', side: 'source' },
  });
  const entryPath = path.join(claude, 'iota');
  const first = await preview(root);
  // 建链后 verify 阶段对入口的 lstat 抛错；清理阶段身份校验用真实结果，应成功移除。
  const restore = failLstatOnNthCall(entryPath, 2);
  let applied;
  try {
    applied = await apply(root, first.report.digest);
  } finally {
    restore();
  }
  assert.equal(applied.exitCode, 1);
  assert.equal(applied.error?.name, 'iota');
  // 入口已被本次清理移除，源保持完整。
  assert.equal(fs.existsSync(entryPath), false);
  assert.equal(fs.existsSync(path.join(agents, 'iota', 'SKILL.md')), true);
});

test('move verify failure: moved skill is restored to its original entry location', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {
    kappa: { type: 'skill', side: 'entry', content: '---\nname: k\n---\nKAPPA' },
  });
  const entryPath = path.join(claude, 'kappa');
  const first = await preview(root);
  // rename 与建链成功后 verify 阶段 lstat 抛错；恢复阶段身份校验真实通过，
  // 应回滚 junction 并把实体目录 rename 回原入口位置。
  const restore = failLstatOnNthCall(entryPath, 2);
  let applied;
  try {
    applied = await apply(root, first.report.digest);
  } finally {
    restore();
  }
  assert.equal(applied.exitCode, 1);
  assert.ok(applied.error);
  // 恢复成功：实体目录回到 entry 位置，源侧无残留。
  assert.equal(fs.lstatSync(entryPath).isSymbolicLink(), false);
  assert.equal(
    (await fsp.readFile(path.join(entryPath, 'SKILL.md'), 'utf8')).includes('KAPPA'),
    true,
  );
  assert.equal(fs.existsSync(path.join(agents, 'kappa')), false);
});

test('batch partial success: earlier items stay applied, later items stopped and reported', async (t) => {
  const { root, agents, claude } = await makeTempProject(t, {
    'a-first': { type: 'skill', side: 'source' },
    'b-blocker': { type: 'skill', side: 'source' },
    'c-third': { type: 'skill', side: 'source' },
  });
  // 预览时 b-blocker 无冲突；apply 时其建链被注入失败，批次在该项停止，
  // a-first（已成功）保留，c-third（stoppedBefore）未被触碰。
  const first = await preview(root);
  assert.equal(findItem(first, 'b-blocker').action, 'link');
  const restore = failSymlinkAt(path.join(claude, 'b-blocker'));
  let applied;
  try {
    applied = await apply(root, first.report.digest);
  } finally {
    restore();
  }
  assert.equal(applied.exitCode, 1);
  assert.equal(applied.error?.name, 'b-blocker');
  assert.deepEqual(applied.stoppedBefore, ['c-third']);
  assert.equal(fs.lstatSync(path.join(claude, 'a-first')).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(claude, 'b-blocker')), false); // 未建成链接、无残留
  assert.equal(fs.existsSync(path.join(claude, 'c-third')), false);
  assert.equal(fs.existsSync(path.join(agents, 'b-blocker', 'SKILL.md')), true);
});

test('case collision: behavior follows the filesystem, report stays consistent', async (t) => {
  const { root, agents } = await makeTempProject(t, {
    dup: { type: 'skill', side: 'source' },
  });
  await writeSkill(path.join(agents, 'DUP'));
  const onDisk = await fsp.readdir(agents);
  const outcome = await preview(root);
  const allNames = outcome.report.items.map((item) => item.name);
  const dupItem = findItem(outcome, 'dup') ?? findItem(outcome, 'DUP');
  assert.ok(dupItem, 'dup variant should be reported');
  if (onDisk.length === 1) {
    // 大小写不敏感文件系统（Windows/macOS 默认）：落盘为一个名字，一条 item。
    assert.equal(allNames.length, 1);
    assert.equal(dupItem.action, 'link');
  } else {
    // 大小写敏感文件系统（Linux）：两个名字落盘，碰撞保护让两项都被跳过或只处理一个。
    assert.equal(allNames.length, 2);
    for (const item of outcome.report.items) {
      assert.equal(item.action, null);
      assert.match(item.note ?? '', /collision|conflict|skipped/);
    }
  }
});

async function snapshot(dir) {
  const out = [];
  await walk(dir, out);
  return out.sort();
}

async function snapshotContents(dir) {
  const out = {};
  await walkContents(dir, out);
  return out;
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      out.push(`link:${full}`);
    } else if (entry.isDirectory()) {
      out.push(`dir:${full}`);
      await walk(full, out);
    } else {
      out.push(`file:${full}`);
    }
  }
}

async function walkContents(dir, out) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // 链接本身由 snapshot 记录
    if (entry.isDirectory()) {
      await walkContents(full, out);
    } else {
      out[full] = (await fsp.readFile(full)).toString('base64');
    }
  }
}
