#!/usr/bin/env node
/**
 * git-up 执行器的性能回归测试。
 *
 * 这些用例守的是「能力不变」：执行器少调 Git 命令，但不能因此改变提交结果、
 * 错误码或校验结论。用例在隔离的临时仓库里跑，不碰用户仓库。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptsRoot = path.join(repositoryRoot, 'skills', 'git-up', 'scripts');
const commitPlanScript = path.join(scriptsRoot, 'commit_plan.mjs');
const planContextScript = path.join(scriptsRoot, 'plan_context.mjs');

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

/** 建一个带初始提交的临时仓库。 */
function makeRepo(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(['init', '--quiet', '--initial-branch=main'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n', 'utf8');
  git(['add', '.'], repo);
  git(['commit', '--quiet', '-m', 'chore: init'], repo);
  return { root, repo };
}

/**
 * 统计执行器在一次提交中实际发起的 Git 子进程数量。
 *
 * 通过预加载钩子计数，不依赖执行器内部实现，也不受 PATH 解析影响。
 */
function countGitCalls(repo, planText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitup-callcount-'));
  const counterFile = path.join(root, 'count.txt');
  fs.writeFileSync(counterFile, '0', 'utf8');

  const planFile = path.join(root, 'plan.yaml');
  fs.writeFileSync(planFile, planText, 'utf8');

  // Windows 上 --import 需要 file:// URL。
  const preloadUrl = pathToFileURL(path.join(repositoryRoot, 'test-space', 'git-up-perf-tests', 'git-call-counter.mjs')).href;

  const result = spawnSync(process.execPath, [commitPlanScript, 'commit', '--cwd', repo, '--plan-file', planFile], {
    encoding: 'utf8',
    cwd: repo,
    env: {
      ...process.env,
      NODE_OPTIONS: `--import ${preloadUrl}`,
      GIT_UP_GIT_CALL_COUNT: counterFile,
    },
  });

  const count = Number.parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
  fs.rmSync(root, { recursive: true, force: true });
  return { count, result };
}

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

// ---------------------------------------------------------------------------

/**
 * Given：一次三步的文件级提交计划。
 * When：执行器跑完整个计划。
 * Then：Git 子进程调用次数控制在上限内。
 * 防回归：执行器此前为同一份计划发起 34 次 Git 调用，其中包含读取后从不使用的
 *         全量 diff 与重复的暂存区探测。
 */
check('执行计划的 Git 调用次数不超上限', () => {
  const { root, repo } = makeRepo('gitup-perf-calls-');
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'c.txt'), 'c\n', 'utf8');
    git(['add', '.'], repo);
    git(['commit', '--quiet', '-m', 'chore: add'], repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a2\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b2\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'c.txt'), 'c2\n', 'utf8');

    const plan = [
      '- step: 1',
      '  subject: "feat(a): ✨改 a"',
      '  files:',
      '    - a.txt',
      '- step: 2',
      '  subject: "feat(b): ✨改 b"',
      '  files:',
      '    - b.txt',
      '- step: 3',
      '  subject: "feat(c): ✨改 c"',
      '  files:',
      '    - c.txt',
      '',
    ].join('\n');

    const { count, result } = countGitCalls(repo, plan);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.ok(
      count <= 26,
      `Git 调用次数应不超过 26，实际 ${count}。执行器又引入了冗余的 Git 调用。`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Given：暂存区为空且计划涉及多个文件。
 * When：执行计划。
 * Then：每个文件各自成为一个提交，最终工作区干净。
 * 防回归：合并暂存区探测后，「无差异」与「路径列表」必须仍然等价，
 *         不能因为少了 `git diff --cached --quiet` 而漏判或误判。
 */
check('多文件计划产生逐文件提交且工作区干净', () => {
  const { root, repo } = makeRepo('gitup-perf-multi-');
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n', 'utf8');
    git(['add', '.'], repo);
    git(['commit', '--quiet', '-m', 'chore: add'], repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a2\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b2\n', 'utf8');

    const plan = [
      '- step: 1',
      '  subject: "feat(a): ✨改 a"',
      '  files:',
      '    - a.txt',
      '- step: 2',
      '  subject: "feat(b): ✨改 b"',
      '  files:',
      '    - b.txt',
      '',
    ].join('\n');

    const planFile = path.join(root, 'plan.yaml');
    fs.writeFileSync(planFile, plan, 'utf8');
    const result = spawnSync(process.execPath, [commitPlanScript, 'commit', '--cwd', repo, '--plan-file', planFile], {
      encoding: 'utf8',
      cwd: repo,
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true, '执行应当成功');
    assert.deepEqual(payload.completed_steps, [1, 2], '两步都应完成');
    assert.equal(payload.verification.status, 'verified', '最终校验应通过');
    assert.equal(payload.commits.length, 2, '应产生两个提交');

    const status = git(['status', '--porcelain'], repo).stdout.trim();
    assert.equal(status, '', `工作区应干净，实际 ${status}`);
    assert.equal(git(['log', '--format=%s', '-2'], repo).stdout.trim().split('\n').length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Given：计划涉及的文件实际没有改动。
 * When：执行计划。
 * Then：该步被报告为 skipped，不产生空提交。
 * 防回归：暂存区探测从「退出码」改为「路径列表」后，空差异的判定不能失效。
 */
check('无改动的步骤被跳过且不产生空提交', () => {
  const { root, repo } = makeRepo('gitup-perf-empty-');
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    git(['add', '.'], repo);
    git(['commit', '--quiet', '-m', 'chore: add'], repo);
    // a.txt 内容未变，只是被计划点名。

    const plan = [
      '- step: 1',
      '  subject: "chore(a): ✨空提交"',
      '  files:',
      '    - a.txt',
      '',
    ].join('\n');

    const planFile = path.join(root, 'plan.yaml');
    fs.writeFileSync(planFile, plan, 'utf8');
    const result = spawnSync(process.execPath, [commitPlanScript, 'commit', '--cwd', repo, '--plan-file', planFile], {
      encoding: 'utf8',
      cwd: repo,
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.skipped_steps, [1], '空步骤应被跳过');
    assert.deepEqual(payload.completed_steps, [], '不应产生提交');
    assert.equal(git(['log', '--format=%s', '-1'], repo).stdout.trim(), 'chore: add', '历史不应变化');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Given：Git 的 index 文件已损坏。
 * When：执行计划。
 * Then：执行失败并返回 git_failed，不把读取失败当成「无差异」而静默跳过。
 * 防回归：合并暂存区探测时，读取失败的分支必须仍然保留。
 */
check('index 损坏时报告 git_failed 而不是静默跳过', () => {
  const { root, repo } = makeRepo('gitup-perf-broken-');
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    git(['add', '.'], repo);
    git(['commit', '--quiet', '-m', 'chore: add'], repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a2\n', 'utf8');
    fs.writeFileSync(path.join(repo, '.git', 'index'), 'not a valid index file', 'utf8');

    const plan = [
      '- step: 1',
      '  subject: "feat(a): ✨改 a"',
      '  files:',
      '    - a.txt',
      '',
    ].join('\n');

    const planFile = path.join(root, 'plan.yaml');
    fs.writeFileSync(planFile, plan, 'utf8');
    const result = spawnSync(process.execPath, [commitPlanScript, 'commit', '--cwd', repo, '--plan-file', planFile], {
      encoding: 'utf8',
      cwd: repo,
    });
    assert.equal(result.status, 1, 'index 损坏时应当失败');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false, '不得报告成功');
    assert.equal(payload.code, 'git_failed', `错误码应为 git_failed，实际 ${payload.code}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Given：一个含已跟踪改动与未跟踪新文件的仓库。
 * When：调用 plan_context.mjs。
 * Then：一次调用返回文件清单、分组计数、diff 统计、分支与最近提交标题。
 * 防回归：规划阶段此前要分开跑多次 git 命令探提交信息惯例，
 *         Agent 侧的工具调用次数是端到端耗时的主要来源。
 */
check('plan_context 一次返回规划所需的全部输入', () => {
  const { root, repo } = makeRepo('gitup-perf-context-');
  try {
    // tracked.txt 先入库，随后修改，才是「已跟踪改动」。
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'original\n', 'utf8');
    git(['add', '.'], repo);
    git(['commit', '--quiet', '-m', 'chore: add tracked'], repo);
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'changed\n', 'utf8');
    // new.txt 从未入库，是未跟踪文件。
    fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n', 'utf8');

    const result = spawnSync(process.execPath, [planContextScript, '--cwd', repo], {
      encoding: 'utf8',
      cwd: repo,
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.branch, 'main', `分支名应正确，实际 ${payload.branch}`);
    assert.equal(payload.counts.total, 2, `应看到两个改动，实际 ${payload.counts.total}`);
    assert.equal(payload.counts.untracked, 1, `未跟踪文件应单独计数，实际 ${payload.counts.untracked}`);
    assert.equal(payload.counts.changed, 1, `已跟踪改动应单独计数，实际 ${payload.counts.changed}`);
    assert.ok(payload.diff_stat.includes('tracked.txt'), 'diff 统计应包含已跟踪文件');
    assert.ok(payload.recent_subjects.includes('chore: init'), '应返回最近提交标题用于推断提交信息惯例');
    assert.ok(
      payload.status.some((entry) => entry.path === 'new.txt' && entry.status === '??'),
      '未跟踪文件的状态码应为 ??',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Given：不在 Git 仓库里的目录。
 * When：调用 plan_context.mjs。
 * Then：返回失败，不输出半截 JSON。
 * 防回归：聚合脚本失败时若输出部分内容，Agent 会据此做出错误的提交计划。
 */
check('plan_context 在非仓库目录报告失败', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitup-perf-norepo-'));
  try {
    const result = spawnSync(process.execPath, [planContextScript, '--cwd', root], {
      encoding: 'utf8',
      cwd: root,
    });
    assert.equal(result.status, 1, '非仓库目录应返回失败退出码');
    assert.equal(result.stdout.trim(), '', '失败时不应输出 JSON');
    assert.ok(result.stderr.includes('git status'), `错误信息应指明失败原因，实际 ${result.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\nGIT_UP_PERF_TESTS_PASSED ${passed}`);
