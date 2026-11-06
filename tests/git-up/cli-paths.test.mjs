import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const cli = fileURLToPath(new URL('../../skills/git-up/scripts/commit_plan.mjs', import.meta.url));
const tempRoot = fs.realpathSync(os.tmpdir());
const ownedSandboxes = new Set();

// 只清理本进程创建的 sandbox；即使用例或初始化失败，也会执行收尾。
after(() => {
  for (const sandbox of ownedSandboxes) {
    assert.equal(path.dirname(sandbox), tempRoot);
    assert.match(path.basename(sandbox), /^git-up-cli-/);
    assert.equal(fs.lstatSync(sandbox).isSymbolicLink(), false);
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

function fixture() {
  const temp = fs.mkdtempSync(path.join(tempRoot, 'git-up-cli-'));
  ownedSandboxes.add(temp);
  const repo = path.join(temp, 'repo');
  const home = path.join(temp, 'home');
  const hooks = path.join(temp, 'hooks');
  for (const dir of [repo, home, hooks]) fs.mkdirSync(dir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  Object.assign(env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, 'empty-gitconfig'), GIT_TERMINAL_PROMPT: '0' });
  const run = (command, args) => spawnSync(command, args, { cwd: repo, env, encoding: 'utf8' });
  const git = (...args) => {
    const result = run('git', args);
    assert.equal(result.status, 0, `git ${args.join(' ')}\n${result.stderr}`);
    return result.stdout;
  };
  git('init', '-q');
  git('config', 'user.name', 'Test User');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'core.hooksPath', hooks);
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.quotePath', 'true');
  git('config', 'core.autocrlf', 'false');
  const plan = path.join(temp, 'plan.yaml');
  const invoke = (mode) => run(process.execPath, [cli, mode, '--cwd', repo, '--plan-file', plan]);
  return { temp, repo, git, plan, invoke };
}

function semanticPathScenario({ quotePath, deleted, added, quoted }) {
  const { temp, repo, git, plan, invoke } = fixture();
  git('config', 'core.quotePath', String(quotePath));

  fs.writeFileSync(path.join(repo, deleted), '旧内容\n', 'utf8');
  git('add', '--', deleted);
  git('commit', '-qm', 'baseline');
  fs.unlinkSync(path.join(repo, deleted));
  fs.writeFileSync(path.join(repo, added), '新内容\n', 'utf8');
  git('add', '-N', '--', added);
  const deletedPatch = git('diff', '--no-renames', '--', deleted);
  const addedPatch = git('diff', '--no-renames', '--', added);
  assert.equal(deletedPatch.startsWith('diff --git "a/'), quoted);
  assert.equal(addedPatch.startsWith('diff --git "a/'), quoted);
  fs.writeFileSync(path.join(temp, 'deleted.patch'), deletedPatch, 'utf8');
  fs.writeFileSync(path.join(temp, 'added.patch'), addedPatch, 'utf8');
  git('reset', '-q', '--', added);

  // 补丁文件使用相对于仓库的路径，避免 Windows 绝对路径转义。
  fs.writeFileSync(plan, `- step: 1\n  subject: "test: 中文路径"\n  changes:\n    - path: ${deleted}\n      patch_mode: patch\n      patch_file: ../deleted.patch\n    - path: ${added}\n      patch_mode: patch\n      patch_file: ../added.patch\n`, 'utf8');
  const parsed = invoke('parse');
  assert.equal(parsed.status, 0, `parse failed\n${parsed.stdout}\n${parsed.stderr}`);
  assert.equal(JSON.parse(parsed.stdout).ok, true);
  const committed = invoke('commit');
  assert.equal(committed.status, 0, `commit failed\n${committed.stdout}\n${committed.stderr}`);
  const result = JSON.parse(committed.stdout);
  assert.equal(result.ok, true);
  assert.deepEqual(result.completed_steps.map((step) => step.step), [1]);
  const entries = git('diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', '-z', 'HEAD').split('\0').filter(Boolean);
  assert.equal(entries.length, 4);
  const statuses = new Map();
  for (let i = 0; i < entries.length; i += 2) statuses.set(entries[i + 1], entries[i]);
  assert.deepEqual(statuses, new Map([[deleted, 'D'], [added, 'A']]));
  assert.match(result.target_tree, /^[0-9a-f]{40,64}$/);
  assert.equal(result.final_tree, result.target_tree);
  assert.equal(result.final_tree, git('rev-parse', 'HEAD^{tree}').trim());
  assert.equal(result.verification.index_clean, true);
  assert.equal(git('diff', '--cached', '--name-only', '-z'), '');
  assert.equal(git('show', `HEAD:${added}`), '新内容\n');
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '2');
  assert.equal(git('status', '--porcelain'), '');
}

// Given：隔离仓库开启 quotePath，已跟踪的中文文件被删除并新增中文文件。
// When：使用真实 Git 补丁和 UTF-8 计划调用 parse 与 commit CLI。
// Then：解析及提交成功，目标树与 HEAD 一致，暂存区和工作区均干净。
test('T01：quotePath=true 时语义计划提交中文删除和新增', () => {
  semanticPathScenario({ quotePath: true, deleted: '原有文件.txt', added: '新增文件.txt', quoted: true });
});

// Given：隔离仓库关闭 quotePath，已跟踪的中文文件被删除并新增中文文件。
// When：使用真实 Git 补丁和 UTF-8 计划调用 parse 与 commit CLI。
// Then：解析及提交成功，目标树与 HEAD 一致，暂存区和工作区均干净。
test('T02：quotePath=false 时语义计划提交中文删除和新增', () => {
  semanticPathScenario({ quotePath: false, deleted: '原有文件.txt', added: '新增文件.txt', quoted: false });
});

// Given：隔离仓库开启 quotePath，已跟踪的 ASCII 文件被删除并新增 ASCII 文件。
// When：使用真实 Git 补丁和 UTF-8 计划调用 parse 与 commit CLI。
// Then：解析及提交成功，目标树与 HEAD 一致，暂存区和工作区均干净。
test('T03：语义计划提交 ASCII 删除和新增', () => {
  semanticPathScenario({ quotePath: true, deleted: 'old.txt', added: 'new.txt', quoted: false });
});

// Given：隔离仓库中有中文已跟踪删除、新增及暂存修改，语义补丁文件存在。
// When：通过 parse CLI 解析引用中文路径的 UTF-8 计划。
// Then：返回中文路径原文，HEAD、暂存区和工作区均不发生变化。
test('T06：parse 保留中文路径且不改变仓库状态', () => {
  const { temp, repo, git, plan, invoke } = fixture();
  const deleted = '待删除.txt';
  const added = '新增.txt';
  fs.writeFileSync(path.join(repo, deleted), '原文\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'staged.txt'), '原文\n', 'utf8');
  git('add', '--', deleted, 'staged.txt');
  git('commit', '-qm', 'baseline');
  fs.unlinkSync(path.join(repo, deleted));
  fs.writeFileSync(path.join(repo, added), '新增内容\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'staged.txt'), '暂存内容\n', 'utf8');
  git('add', '--', 'staged.txt');
  fs.writeFileSync(path.join(temp, 'empty.patch'), '', 'utf8');
  fs.writeFileSync(plan, `- step: 1\n  subject: "test: 只解析"\n  changes:\n    - path: ${deleted}\n      patch_file: ../empty.patch\n    - path: ${added}\n      patch_file: ../empty.patch\n`, 'utf8');
  const snapshot = () => ({
    head: git('rev-parse', 'HEAD').trim(),
    index: git('ls-files', '--stage', '-z'),
    status: git('status', '--porcelain=v1', '-uall', '-z'),
    diff: git('diff', '--binary'),
    added: fs.readFileSync(path.join(repo, added), 'utf8'),
    deleted: fs.existsSync(path.join(repo, deleted)),
  });
  const before = snapshot();
  const parsed = invoke('parse');
  assert.equal(parsed.status, 0, `parse failed\n${parsed.stdout}\n${parsed.stderr}`);
  const result = JSON.parse(parsed.stdout);
  assert.equal(result.ok, true);
  assert.deepEqual(result.scope_paths, [deleted, added].sort());
  assert.deepEqual(result.steps[0].changes.map((change) => change.path), [deleted, added]);
  assert.deepEqual(snapshot(), before);
});

// Given：隔离仓库开启 quotePath，一个已跟踪的中文文件被删除。
// When：使用 files 文件级 UTF-8 计划调用 parse 与 commit CLI。
// Then：删除提交成功，目标树匹配，HEAD 恰好新增一个提交且暂存区干净。
test('T04：文件级计划提交中文路径删除', () => {
  const { repo, git, plan, invoke } = fixture();
  const deleted = '已删除.txt';
  fs.writeFileSync(path.join(repo, deleted), '原内容\n', 'utf8');
  git('add', '--', deleted);
  git('commit', '-qm', 'baseline');
  fs.unlinkSync(path.join(repo, deleted));
  fs.writeFileSync(plan, `- step: 1\n  subject: "test: 删除中文文件"\n  files:\n    - ${deleted}\n`, 'utf8');
  const parsed = invoke('parse');
  assert.equal(parsed.status, 0, `parse failed\n${parsed.stdout}\n${parsed.stderr}`);
  const committed = invoke('commit');
  assert.equal(committed.status, 0, `commit failed\n${committed.stdout}\n${committed.stderr}`);
  const result = JSON.parse(committed.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'file');
  assert.deepEqual(result.completed_steps, [1]);
  assert.equal(result.target_tree, result.final_tree);
  assert.equal(result.final_tree, git('rev-parse', 'HEAD^{tree}').trim());
  assert.equal(git('diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', '-z', 'HEAD'), `D\0${deleted}\0`);
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '2');
  assert.equal(git('diff', '--cached', '--name-only', '-z'), '');
  assert.equal(git('status', '--porcelain'), '');
});

// Given：分别准备有 HEAD 和无 HEAD 的隔离仓库，中文目标路径在工作区和基线均不存在，补丁文件存在。
// When：解析后执行引用该缺失路径的语义计划。
// Then：两种仓库均拒绝计划，报告缺失路径，不新增提交或暂存修改。
test('T05：有 HEAD 和无 HEAD 均拒绝真正缺失的路径', async (t) => {
  for (const hasHead of [true, false]) {
    // Given：按子用例准备有 HEAD 或无 HEAD 的仓库，目标中文路径不存在且补丁文件存在。
    // When：调用 parse 和 commit CLI 执行缺失路径计划。
    // Then：commit 拒绝该路径，HEAD、暂存区和工作区保持原样。
    await t.test(hasHead ? '有 HEAD' : '无 HEAD', () => {
      const { temp, repo, git, plan, invoke } = fixture();
      if (hasHead) {
        fs.writeFileSync(path.join(repo, 'baseline.txt'), 'baseline\n');
        git('add', '--', 'baseline.txt');
        git('commit', '-qm', 'baseline');
      }
      const before = hasHead ? git('rev-parse', 'HEAD').trim() : null;
      fs.writeFileSync(path.join(temp, 'empty.patch'), '', 'utf8');
      fs.writeFileSync(plan, '- step: 1\n  subject: "test: 缺失路径"\n  changes:\n    - path: 不存在.txt\n      patch_mode: patch\n      patch_file: ../empty.patch\n', 'utf8');
      const parsed = invoke('parse');
      assert.equal(parsed.status, 0, `parse hasHead=${hasHead}\n${parsed.stdout}\n${parsed.stderr}`);
      const committed = invoke('commit');
      assert.equal(committed.status, 1, `commit hasHead=${hasHead}\n${committed.stdout}\n${committed.stderr}`);
      const result = JSON.parse(committed.stdout);
      assert.equal(result.ok, false);
      assert.equal(result.code, 'invalid_plan');
      assert.match(result.message, /path does not exist in the worktree or the base commit: 不存在\.txt/);
      if (hasHead) assert.equal(git('rev-parse', 'HEAD').trim(), before);
      else assert.equal(git('rev-list', '--all', '--count').trim(), '0');
      assert.equal(git('diff', '--cached', '--name-only', '-z'), '');
      assert.equal(git('status', '--porcelain'), '');
    });
  }
});
