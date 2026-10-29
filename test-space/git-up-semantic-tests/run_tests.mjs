#!/usr/bin/env node
/**
 * git-up 语义拆分提交的回归测试。
 *
 * 测试通过公开 CLI 行为验证外部契约：解析计划、执行提交、检查最终状态。
 * 所有 Git 操作都在临时仓库中进行，不触碰任何真实仓库。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { stagedDiffState } from '../../skills/git-up/scripts/gitup_semantic.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PROJECT_ROOT = path.resolve(ROOT, '..', '..');
const SCRIPT = path.join(PROJECT_ROOT, 'skills', 'git-up', 'scripts', 'commit_plan.mjs');
const FAST_PATH_SCRIPT = path.join(PROJECT_ROOT, 'skills', 'git-up', 'scripts', 'inspect_fast_path.mjs');
const SPLIT_SCRIPT = path.join(PROJECT_ROOT, 'skills', 'git-up', 'scripts', 'split_patch.mjs');

class TestFailure extends Error {}

function runCommand(command, cwd, stdin = null, env = null) {
  return spawnSync(command[0], command.slice(1), {
    cwd,
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function git(repo, ...args) {
  return runCommand(['git', ...args], repo);
}

/** 以二进制方式运行 git，用于读取二进制文件内容。 */
function gitBuffer(repo, ...args) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
  };
}

/** 在指定环境变量下运行 git，用于临时 index 场景。 */
function gitWithEnv(repo, env, ...args) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  return {
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function assertTrue(condition, message) {
  if (!condition) throw new TestFailure(message);
}

function parseJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new TestFailure(`输出不是合法 JSON: ${result.stdout}`);
  }
}

function initRepo(repo) {
  git(repo, 'init');
  git(repo, 'config', 'user.name', 'Codex Test');
  git(repo, 'config', 'user.email', 'codex-test@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
}

function runPlan(mode, yamlText, cwd = null, extraArgs = null, env = null) {
  const args = [SCRIPT, mode];
  if (extraArgs) args.push(...extraArgs);
  if (cwd !== null) args.push('--cwd', cwd);
  return runCommand([process.execPath, ...args], PROJECT_ROOT, yamlText, env);
}

function runPlanFile(mode, planPath, cwd, extraArgs = null) {
  const args = [SCRIPT, mode, '--cwd', cwd, '--plan-file', planPath];
  if (extraArgs) args.push(...extraArgs);
  return runCommand([process.execPath, ...args], PROJECT_ROOT);
}

function runFastPath(cwd, planPath = null) {
  const args = [FAST_PATH_SCRIPT, '--cwd', cwd];
  if (planPath !== null) args.push('--plan-file', planPath);
  return runCommand([process.execPath, ...args], PROJECT_ROOT);
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function writeBytes(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

/**
 * 用 split_patch.mjs 把 git diff 拆成独立补丁文件。
 *
 * 使用真实的拆分脚本，而不是测试内的复制实现。
 */
function splitDiffIntoPatches(repo, target, outDir, prefix) {
  const diff = git(repo, 'diff', '-U1', '--', target);
  assertTrue(diff.status === 0, `生成 diff 失败: ${diff.stderr}`);
  const diffPath = path.join(outDir, 'full.patch');
  fs.mkdirSync(outDir, { recursive: true });
  writeFile(diffPath, diff.stdout);
  const result = runCommand(
    [process.execPath, SPLIT_SCRIPT, '--diff', diffPath, '--out', outDir, '--prefix', prefix],
    PROJECT_ROOT,
  );
  assertTrue(result.status === 0, `拆分补丁失败: ${result.stderr}`);
  const manifest = parseJson(result);
  const patches = [];
  for (const file of manifest.files) {
    for (const hunk of file.hunks) patches.push(hunk.patch);
  }
  return patches;
}

/** 用临时 index 计算范围路径的目标树，与执行器使用同一口径。 */
function targetTreeOf(repo, base, scope) {
  const indexPath = path.join(repo, '.git-up-test-index');
  const env = { GIT_INDEX_FILE: indexPath };
  try {
    gitWithEnv(repo, env, 'read-tree', base);
    gitWithEnv(repo, env, 'add', '-A', '--', ...scope);
    const written = gitWithEnv(repo, env, 'write-tree');
    assertTrue(written.status === 0, `写入目标树失败: ${written.stderr}`);
    return written.stdout.trim();
  } finally {
    if (fs.existsSync(indexPath)) fs.rmSync(indexPath, { force: true });
  }
}

/** 把步骤数组渲染为 YAML Lite 计划文本。 */
function semanticPlan(steps) {
  const lines = [];
  for (const step of steps) {
    lines.push(`- step: ${step.step}`);
    lines.push(`  subject: "${step.subject}"`);
    if (step.reason) lines.push(`  reason: "${step.reason}"`);
    const depends = step.depends_on ?? [];
    if (depends.length > 0) {
      lines.push('  depends_on:');
      for (const item of depends) lines.push(`    - ${item}`);
    }
    lines.push('  changes:');
    for (const change of step.changes) {
      lines.push(`    - path: ${change.path}`);
      lines.push(`      patch_mode: ${change.patch_mode ?? 'patch'}`);
      lines.push(`      patch_file: ${change.patch_file}`);
      if (change.whitespace) lines.push(`      whitespace: ${change.whitespace}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** 建立一次性工作目录。 */
function withWork(prefix, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 建立一次性仓库并预先初始化。 */
function withRepo(prefix, body, seed = null) {
  return withWork(prefix, (work) => {
    const repo = path.join(work, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    if (seed) seed(repo);
    return body(work, repo);
  });
}

// ---------------------------------------------------------------------------
// 解析测试
// ---------------------------------------------------------------------------
function testParseFilePlanStaysCompatible() {
  /**
   * Given：兼容的文件级计划，只声明 step、subject 和 files。
   * When：commit_plan.mjs parse 解析该计划。
   * Then：返回 plan_mode=file，步骤字段与原有契约一致。
   * 防回归：语义扩展不得破坏已有的文件级计划格式。
   */
  const yamlText = `- step: 1
  subject: "docs(readme): update usage"
  files:
    - README.md
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 0, result.stderr || result.stdout);
  assertTrue(payload.ok === true, '解析应成功');
  assertTrue(payload.plan_mode === 'file', '文件级计划应报告 file 模式');
  const step = payload.steps[0];
  assertTrue(step.files.length === 1 && step.files[0] === 'README.md', 'files 应保留原样');
  assertTrue(step.changes.length === 0, '文件级计划不应产生 changes');
  assertTrue(step.depends_on.length === 0, '文件级计划不应产生 depends_on');
}

function testParseSemanticPlanReadsChanges() {
  /**
   * Given：语义计划声明 reason、depends_on 和一条 changes 条目。
   * When：commit_plan.mjs parse 解析该计划。
   * Then：返回 plan_mode=semantic，并完整保留变更字段。
   * 防回归：避免执行器拿不到补丁路径而回退到文件级暂存。
   */
  return withWork('git-up-sem-parse-', (work) => {
    const patch = path.join(work, 'step-1.patch');
    writeFile(patch, 'diff --git a/a.txt b/a.txt\n');
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat(core): ✨拆分提交',
        reason: '依赖安装与脚本增加分离',
        changes: [{ path: 'a.txt', patch_mode: 'patch', patch_file: patch }],
      },
    ]);
    const result = runPlan('parse', yamlText, work);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(payload.plan_mode === 'semantic', '应报告 semantic 模式');
    const step = payload.steps[0];
    assertTrue(step.reason === '依赖安装与脚本增加分离', 'reason 应保留');
    assertTrue(step.changes.length === 1, '应解析出一条变更');
    assertTrue(step.changes[0].path === 'a.txt', '变更路径应保留');
    assertTrue(step.changes[0].patch_mode === 'patch', '补丁模式应保留');
    assertTrue(step.changes[0].patch_file === patch, '补丁文件路径应保留');
    assertTrue(
      payload.semantic_split_reasons.includes('changes_present'),
      '应报告需要语义拆分',
    );
  });
}

function testParseSemanticPlanAllowsRepeatedPaths() {
  /**
   * Given：同一文件出现在两个语义步骤的 changes 中。
   * When：commit_plan.mjs parse 解析该计划。
   * Then：解析成功，且两个步骤各自保留该路径。
   * 防回归：一个文件必须能够拆进多个语义提交。
   */
  return withWork('git-up-sem-repeat-', (work) => {
    const first = path.join(work, 's1.patch');
    const second = path.join(work, 's2.patch');
    writeFile(first, 'diff --git a/package.json b/package.json\n');
    writeFile(second, 'diff --git a/package.json b/package.json\n');
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'build(deps): 安装依赖',
        changes: [{ path: 'package.json', patch_file: first }],
      },
      {
        step: 2,
        subject: 'build(scripts): 增加脚本',
        changes: [{ path: 'package.json', patch_file: second }],
      },
    ]);
    const result = runPlan('parse', yamlText, work);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(payload.steps.length === 2, '应解析出两个步骤');
    assertTrue(payload.steps[0].changes[0].path === 'package.json', '首个步骤应保留路径');
    assertTrue(payload.steps[1].changes[0].path === 'package.json', '第二个步骤应保留路径');
    assertTrue(
      payload.semantic_split_reasons.includes('shared_path_across_steps'),
      '应报告路径被多个步骤共享',
    );
  });
}

function testParseSemanticPlanReadsDependencies() {
  /**
   * Given：语义步骤用四空格列表声明 depends_on。
   * When：commit_plan.mjs parse 解析该计划。
   * Then：depends_on 解析为整数列表，并报告存在依赖关系。
   * 防回归：依赖顺序是提交顺序的唯一权威来源，不得丢失。
   */
  return withWork('git-up-sem-dep-', (work) => {
    const patch = path.join(work, 's.patch');
    writeFile(patch, 'diff --git a/a.txt b/a.txt\n');
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'build(deps): 安装依赖',
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
      {
        step: 2,
        subject: 'build(scripts): 增加脚本',
        depends_on: [1],
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    const result = runPlan('parse', yamlText, work);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(
      payload.steps[1].depends_on.length === 1 && payload.steps[1].depends_on[0] === 1,
      '依赖应解析为整数列表',
    );
    assertTrue(
      payload.semantic_split_reasons.includes('dependencies_present'),
      '应报告存在依赖',
    );
  });
}

function testParseRejectsMalformedChanges() {
  /**
   * Given：changes 条目缺少 path 字段。
   * When：commit_plan.mjs parse 校验该语义计划。
   * Then：返回 invalid_plan 错误码。
   * 防回归：禁止执行器在变更缺少路径时猜测暂存目标。
   */
  const yamlText = `- step: 1
  subject: "feat: broken change"
  changes:
    - patch_mode: patch
      patch_file: missing.patch
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 2, '非法变更应返回错误码 2');
  assertTrue(payload.code === 'invalid_plan', '错误码应为 invalid_plan');
}

function testParseRejectsInvalidPatchReference() {
  /**
   * Given：语义计划引用一个不存在的补丁文件。
   * When：commit_plan.mjs parse 在指定仓库下校验该计划。
   * Then：返回 invalid_plan 错误码，并指出缺失的补丁文件。
   * 防回归：补丁缺失必须显式失败，不得跳过该变更继续提交。
   */
  return withWork('git-up-sem-missing-', (work) => {
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: missing patch',
        changes: [{ path: 'a.txt', patch_file: path.join(work, 'absent.patch') }],
      },
    ]);
    const result = runPlan('parse', yamlText, work);
    const payload = parseJson(result);
    assertTrue(result.status === 2, '缺失补丁应返回错误码 2');
    assertTrue(payload.code === 'invalid_plan', '错误码应为 invalid_plan');
    assertTrue(payload.message.includes('absent.patch'), '错误信息应指出缺失的补丁文件');
  });
}

function testParseRejectsSemanticStepWithoutChanges() {
  /**
   * Given：计划中一个步骤声明 changes，另一个步骤只声明 files。
   * When：commit_plan.mjs parse 校验该计划。
   * Then：返回 invalid_plan，且不产生任何变更条目。
   * 防回归：语义计划不得回退到文件级暂存。
   */
  const yamlText = `- step: 1
  subject: "feat: semantic step"
  changes:
    - path: a.txt
      patch_mode: patch
      patch_file: s1.patch
- step: 2
  subject: "feat: file step"
  files:
    - b.txt
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 2, '混合计划应返回错误码 2');
  assertTrue(payload.code === 'invalid_plan', '错误码应为 invalid_plan');
}

function testParseRejectsSemanticStepDeclaringFiles() {
  /**
   * Given：语义步骤同时声明 changes 和 files。
   * When：commit_plan.mjs parse 校验该计划。
   * Then：返回 invalid_plan，提示用 changes 描述每一处改动。
   防回归：语义模式不得静默忽略 files，否则计划声明与实际提交范围不一致。
   */
  const yamlText = `- step: 1
  subject: "feat: mixed step"
  changes:
    - path: a.txt
      patch_mode: patch
      patch_file: s1.patch
  files:
    - b.txt
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 2, '语义步骤声明 files 应返回错误码 2');
  assertTrue(payload.code === 'invalid_plan', '错误码应为 invalid_plan');
  assertTrue(payload.message.includes('files'), '错误信息应指出 files 字段');
}

function testParseRejectsDependencyCycle() {
  /**
   * Given：两个语义步骤互相依赖。
   * When：commit_plan.mjs commit 执行该计划。
   * Then：返回 dependency_cycle，且不创建任何提交。
   * 防回归：依赖成环时不得按任意顺序提交。
   */
  return withRepo('git-up-sem-cycle-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'base\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    const patch = path.join(work, 's.patch');
    writeFile(patch, 'diff --git a/a.txt b/a.txt\n');
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: one',
        depends_on: [2],
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
      {
        step: 2,
        subject: 'feat: two',
        depends_on: [1],
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    const before = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    const after = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    assertTrue(result.status === 1, '依赖成环应返回失败');
    assertTrue(payload.code === 'dependency_cycle', '错误码应为 dependency_cycle');
    assertTrue(before === after, '依赖成环时不应创建提交');
  });
}

// ---------------------------------------------------------------------------
// 暂存层测试
// ---------------------------------------------------------------------------
function testSplitPatchProducesOneFilePerHunk() {
  /**
   * Given：一个包含两处远距离改动的文件，以及一个包含两个文件的 diff。
   * When：split_patch.mjs 按 hunk 拆分该 diff。
   * Then：每个 hunk 得到独立补丁文件，清单给出文件与 hunk 的对应关系。
   * 防回归：把 diff 拆成单 hunk 补丁是语义拆分的基础步骤，必须可靠。
   */
  return withRepo('git-up-sem-split-tool-', (work, repo) => {
    const base = Array.from({ length: 20 }, (_, index) => `l${index + 1}`).join('\n') + '\n';
    writeFile(path.join(repo, 'f.txt'), base);
    writeFile(path.join(repo, 'g.txt'), base);
    git(repo, 'add', 'f.txt', 'g.txt');
    git(repo, 'commit', '-m', 'init');
    const changed = base.split('\n');
    changed[2] = 'L3';
    changed[14] = 'L15';
    writeFile(path.join(repo, 'f.txt'), changed.join('\n'));
    const changedOther = base.split('\n');
    changedOther[7] = 'L8';
    writeFile(path.join(repo, 'g.txt'), changedOther.join('\n'));

    const diffPath = path.join(work, 'full.patch');
    writeFile(diffPath, git(repo, 'diff', '-U1').stdout);
    const outDir = path.join(work, 'patches');
    const result = runCommand(
      [process.execPath, SPLIT_SCRIPT, '--diff', diffPath, '--out', outDir, '--prefix', 'split'],
      PROJECT_ROOT,
    );
    const manifest = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(manifest.ok === true, '拆分应成功');
    assertTrue(manifest.files.length === 2, `应识别两个文件，实际 ${manifest.files.length}`);
    assertTrue(manifest.patch_count === 3, `应拆出三个补丁，实际 ${manifest.patch_count}`);
    const fFile = manifest.files.find((item) => item.path === 'f.txt');
    assertTrue(fFile && fFile.hunks.length === 2, 'f.txt 应有两个 hunk');
    for (const hunk of fFile.hunks) {
      const content = fs.readFileSync(hunk.patch, 'utf8');
      assertTrue(content.startsWith('diff --git a/f.txt b/f.txt'), '补丁应保留 git 头部');
      assertTrue(
        (content.match(/^@@/gm) ?? []).length === 1,
        '每个补丁文件只能包含一个 hunk',
      );
    }
  });
}

function testSplitPatchReportsBinaryFiles() {
  /**
   * Given：一个包含文本改动和二进制改动的 diff。
   * When：split_patch.mjs 拆分该 diff。
   * Then：二进制文件被标出且不产生 hunk 补丁，文本文件正常拆分。
   防回归：二进制改动无法按 hunk 拆分，清单必须让调用方看见这一点。
   */
  return withRepo('git-up-sem-split-binary-', (work, repo) => {
    writeFile(path.join(repo, 'code.txt'), 'one\ntwo\nthree\nfour\nfive\n');
    git(repo, 'add', 'code.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'code.txt'), 'one\ntwo\nthree\nfour\nFIVE\n');
    writeBytes(path.join(repo, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]));
    git(repo, 'add', '-N', 'blob.bin');

    const diffPath = path.join(work, 'full.patch');
    writeFile(diffPath, git(repo, 'diff', '--binary').stdout);
    const outDir = path.join(work, 'patches');
    const result = runCommand(
      [process.execPath, SPLIT_SCRIPT, '--diff', diffPath, '--out', outDir, '--prefix', 'bin'],
      PROJECT_ROOT,
    );
    const manifest = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    const binary = manifest.files.find((item) => item.path === 'blob.bin');
    const text = manifest.files.find((item) => item.path === 'code.txt');
    assertTrue(binary !== undefined, '清单应包含二进制文件');
    assertTrue(binary.binary === true, '二进制文件应被标出');
    assertTrue(binary.hunks.length === 0, '二进制文件不应产生 hunk 补丁');
    assertTrue(text !== undefined && text.binary === false, '文本文件不应被标为二进制');
    assertTrue(text.hunks.length >= 1, '文本文件应产生 hunk 补丁');
  });
}

function testParseRejectsScalarDependsOn() {
  /**
   * Given：语义步骤把 depends_on 写成单个整数而不是列表。
   * When：commit_plan.mjs parse 校验该计划。
   * Then：返回 invalid_plan，说明 depends_on 必须是列表。
   防回归：标量写法曾被静默丢弃，导致依赖顺序失效且步骤按书写顺序执行。
   */
  const yamlText = `- step: 1
  subject: "feat: scalar dependency"
  depends_on: 1
  changes:
    - path: a.txt
      patch_mode: patch
      patch_file: s.patch
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 2, '标量 depends_on 应返回错误码 2');
  assertTrue(payload.code === 'invalid_plan', '错误码应为 invalid_plan');
  assertTrue(payload.message.includes('depends_on'), '错误信息应指出 depends_on');
}

function testSemanticModeHandlesNonAsciiPath() {
  /**
   * Given：仓库中有一个中文文件名的文件，Git 输出时会把路径转义为八进制。
   * When：语义计划声明该中文路径并执行。
   Then：执行成功，提交中包含该文件，范围校验不误报越界。
   防回归：Git 的路径转义曾使中文文件名被误判为越界路径，语义模式在该场景不可用。
   */
  return withRepo('git-up-sem-unicode-', (work, repo) => {
    writeFile(path.join(repo, '文.txt'), '一\n');
    git(repo, 'add', '文.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, '文.txt'), '二\n');

    const diffPath = path.join(work, 'full.patch');
    writeFile(diffPath, git(repo, 'diff', '--', '文.txt').stdout);
    const outDir = path.join(work, 'patches');
    const split = runCommand(
      [process.execPath, SPLIT_SCRIPT, '--diff', diffPath, '--out', outDir, '--prefix', 'u'],
      PROJECT_ROOT,
    );
    const manifest = parseJson(split);
    const patch = manifest.files[0].hunks[0].patch;

    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat(文): ✨中文路径',
        changes: [{ path: '文.txt', patch_file: patch }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.completed_steps.length === 1, '应产生一个提交');
    const committed = git(repo, 'show', '--name-only', '--format=', '-z', 'HEAD').stdout;
    assertTrue(committed.includes('文.txt'), `中文文件应进入提交，实际 ${committed}`);
    assertTrue(payload.verification.ok === true, '最终校验应通过');
  });
}

function testFailureLeavesIndexClean() {
  /**
   * Given：一个步骤包含两个变更，第一个合法，第二个触碰未声明的路径。
   * When：执行语义计划并在第二个变更上报错。
   Then：返回 patch_scope_mismatch，且暂存区为空，没有计划外内容留在 index。
   防回归：中途失败曾把已暂存的计划内容留在 index，用户随后的一次 git commit 会提交计划外内容。
   */
  return withRepo('git-up-sem-clean-index-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    writeFile(path.join(repo, 'b.txt'), 'two\n');
    git(repo, 'add', 'a.txt', 'b.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'a.txt'), 'one changed\n');
    writeFile(path.join(repo, 'b.txt'), 'two changed\n');

    const patchA = path.join(work, 'a.patch');
    const patchB = path.join(work, 'b.patch');
    writeFile(patchA, git(repo, 'diff', '--', 'a.txt').stdout);
    writeFile(patchB, git(repo, 'diff', '--', 'b.txt').stdout);

    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: partially valid step',
        changes: [
          { path: 'a.txt', patch_file: patchA },
          { path: 'a.txt', patch_file: patchB },
        ],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 1, '越界变更应返回失败');
    assertTrue(payload.code === 'patch_scope_mismatch', `错误码应为 patch_scope_mismatch，实际 ${payload.code}`);
    const staged = git(repo, 'diff', '--cached', '--name-only').stdout.trim();
    assertTrue(staged === '', `失败后暂存区应为空，实际 ${staged}`);
    const head = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    const tree = git(repo, 'rev-parse', 'HEAD^{tree}').stdout.trim();
    assertTrue(tree === git(repo, 'rev-parse', 'HEAD~0^{tree}').stdout.trim(), 'HEAD 不应被改动');
    assertTrue(head.length > 0, 'HEAD 应仍然有效');
  });
}

function testPatchBodyLinesAreNotMistakenForHeaders() {
  /**
   Given：被删除的行内容是 "-- a/x"，被新增的行内容是 "++ b/x"。
   When：执行器扫描补丁里的文件头。
   Then：hunk 正文中的相似行不被当成文件头，范围校验不误报越界。
   防回归：hunk 正文里的 "--- a/x" 曾被误判为文件头，导致合法补丁被拒绝。
   */
  return withRepo('git-up-sem-hunk-body-', (work, repo) => {
    writeFile(path.join(repo, 'code.txt'), '-- a/x\nkeep\n');
    git(repo, 'add', 'code.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'code.txt'), '++ b/x\nkeep\n');

    const diffPath = path.join(work, 'full.patch');
    writeFile(diffPath, git(repo, 'diff', '--', 'code.txt').stdout);
    const outDir = path.join(work, 'patches');
    const split = runCommand(
      [process.execPath, SPLIT_SCRIPT, '--diff', diffPath, '--out', outDir, '--prefix', 'h'],
      PROJECT_ROOT,
    );
    const manifest = parseJson(split);
    const patch = manifest.files[0].hunks[0].patch;

    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: hunk body lookalike',
        changes: [{ path: 'code.txt', patch_file: patch }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.completed_steps.length === 1, '应产生一个提交');
    const content = git(repo, 'show', 'HEAD:code.txt').stdout;
    assertTrue(content.startsWith('++ b/x'), 'hunk 正文应被正确应用');
  });
}

function testEmptyPatchIsReportedAsSkipped() {
  /**
   * Given：一个语义步骤的补丁文件没有任何 diff 内容。
   * When：执行语义计划。
   * Then：该步骤报告为 skipped，且原因里指出哪个补丁文件没有 diff 内容。
   防回归：补丁生成失败曾被静默跳过，调用方看不出声明的改动没有落地。
   */
  return withRepo('git-up-sem-empty-patch-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    const patch = path.join(work, 'empty.patch');
    writeFile(patch, '');
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: empty patch',
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.skipped_steps.length === 1, '应报告一个跳过的步骤');
    assertTrue(
      payload.skipped_steps[0].reason.includes('empty.patch'),
      `跳过原因应指出补丁文件，实际 ${payload.skipped_steps[0].reason}`,
    );
  });
}

function testBrokenIndexIsReportedAsFailure() {
  /**
   * Given：仓库的 index 文件已损坏，git 无法读取暂存区。
   * When：执行语义计划。
   * Then：返回 git_failed，不把读取失败当成没有差异。
   防回归：git 执行失败曾被当成"没有差异"，整步被静默跳过。
   */
  return withRepo('git-up-sem-broken-index-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'a.txt'), 'one changed\n');
    const patch = path.join(work, 'a.patch');
    writeFile(patch, git(repo, 'diff', '--', 'a.txt').stdout);
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: broken index',
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    // 破坏 index 文件，让 git 无法读取暂存区。
    fs.writeFileSync(path.join(repo, '.git', 'index'), 'not a valid index file');
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 1, `index 损坏时应返回失败，实际 ${result.stdout}`);
    assertTrue(payload.ok === false, '不得报告成功');
    assertTrue(payload.code === 'git_failed', `错误码应为 git_failed，实际 ${payload.code}`);
  });
}

function testStagedDiffStateReportsGitFailure() {
  /**
   * Given：仓库的 index 文件已损坏，git 无法读取暂存区。
   * When：调用 stagedDiffState 判断暂存区是否有差异。
   * Then：返回错误信息，而不是把它当成"没有差异"。
   防回归：git 执行失败曾被当成无差异，整步会被静默跳过。
   */
  return withRepo('git-up-sem-diff-state-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    fs.writeFileSync(path.join(repo, '.git', 'index'), 'not a valid index file');
    const state = stagedDiffState(repo);
    assertTrue(state.hasDiff === false, '读取失败时不得报告存在差异');
    assertTrue(typeof state.error === 'string' && state.error.length > 0, '读取失败时必须报告错误');
  });
}

function testReasonIsNotWrittenIntoCommitMessage() {
  /**
   * Given：语义步骤声明 reason，提交信息只包含 subject 与 body。
   * When：执行语义计划并读取生成的提交信息。
   * Then：提交信息里没有 reason 的内容，reason 只用于审阅。
   防回归：reason 是审阅字段，混入提交信息会污染历史。
   */
  return withRepo('git-up-sem-reason-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'b.txt'), 'two\n');
    const state = path.join(work, 'state.txt');
    writeFile(state, 'two\n');
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat(core): ✨主题',
        reason: 'REASON_MARKER_不进入提交信息',
        changes: [{ path: 'b.txt', patch_mode: 'content', patch_file: state }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    const message = git(repo, 'log', '-1', '--format=%B').stdout;
    assertTrue(!message.includes('REASON_MARKER'), 'reason 不得进入提交信息');
    assertTrue(message.includes('feat(core): ✨主题'), '主题应进入提交信息');
    assertTrue(payload.completed_steps[0].subject === 'feat(core): ✨主题', '结果应报告主题');
  });
}

function testFailedExecutionReportsOnlyRealCommits() {
  /**
   * Given：第一步成功提交，第二步的补丁触碰未声明的路径而失败。
   * When：执行语义计划。
   * Then：结果为失败，completed_steps 只包含真实产生的提交。
   防回归：委派场景依赖这个边界。父智能体据此判断是否接管，失败结果不得虚报提交。
   */
  return withRepo('git-up-sem-delegate-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    writeFile(path.join(repo, 'b.txt'), 'two\n');
    git(repo, 'add', 'a.txt', 'b.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'a.txt'), 'one changed\n');
    writeFile(path.join(repo, 'b.txt'), 'two changed\n');
    const patchA = path.join(work, 'a.patch');
    const patchB = path.join(work, 'b.patch');
    writeFile(patchA, git(repo, 'diff', '--', 'a.txt').stdout);
    writeFile(patchB, git(repo, 'diff', '--', 'b.txt').stdout);

    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat(a): ✨第一步',
        changes: [{ path: 'a.txt', patch_file: patchA }],
      },
      {
        step: 2,
        subject: 'feat(b): ✨第二步',
        depends_on: [1],
        changes: [{ path: 'a.txt', patch_file: patchB }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 1, '第二步失败应返回失败');
    assertTrue(payload.ok === false, '不得报告成功');
    assertTrue(payload.code === 'patch_scope_mismatch', `错误码应为 patch_scope_mismatch，实际 ${payload.code}`);
    assertTrue(
      payload.completed_steps.length === 1 && payload.completed_steps[0].step === 1,
      'completed_steps 只应包含真实产生的提交',
    );
    assertTrue(payload.completed_steps[0].sha.length > 0, '已完成步骤应带 SHA');
    const head = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    assertTrue(head === payload.completed_steps[0].sha, 'HEAD 应与报告的最后一次提交一致');
  });
}

function testStageSplitsOneFileIntoTwoCommits() {
  /**
   * Given：一个文本文件的两处修改被拆成两个独立补丁。
   * When：commit_plan.mjs commit 执行两步语义计划。
   * Then：产生两个提交，且最终内容等于目标工作区内容。
   * 防回归：同一文件必须能够拆进多个可独立回滚的提交。
   */
  return withRepo('git-up-sem-split-', (work, repo) => {
    writeFile(path.join(repo, 'code.txt'), 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n');
    git(repo, 'add', 'code.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'code.txt'), 'L1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nL9\nl10\n');

    const patches = splitDiffIntoPatches(repo, 'code.txt', path.join(work, 'patches'), 'split');
    assertTrue(patches.length === 2, `应拆出两个补丁，实际 ${patches.length}`);

    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat(code): ✨第一处改动',
        changes: [{ path: 'code.txt', patch_file: patches[0] }],
      },
      {
        step: 2,
        subject: 'feat(code): ✨第二处改动',
        depends_on: [1],
        changes: [{ path: 'code.txt', patch_file: patches[1] }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.ok === true, '执行应成功');
    assertTrue(payload.completed_steps.length === 2, '应产生两个提交');
    assertTrue(
      payload.completed_steps[0].subject.startsWith('feat(code)'),
      '第一个提交主题应保持原样',
    );
    const content = git(repo, 'show', 'HEAD:code.txt').stdout;
    assertTrue(
      content === 'L1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nL9\nl10\n',
      '最终内容应等于目标内容',
    );
  });
}

/** 判断参数里是否出现某个短选项。`-am` 这样的组合短选项也要能识别。 */
function hasShortFlag(args, letter) {
  return args.some((item) => /^-[^-]/.test(item) && item.slice(1).includes(letter));
}

/** 列出禁止的 git 调用形态。 */
function forbiddenGitReason(argv) {
  const args = argv.slice(1);
  const subcommand = args[0];
  if (!subcommand) return null;

  if (subcommand === 'add') {
    // 只允许带明确路径的暂存。裸 add、裸 add -A 和 add . 都禁止。
    const rest = args.slice(1);
    const separator = rest.indexOf('--');
    const paths = separator === -1 ? rest.filter((item) => !item.startsWith('-')) : rest.slice(separator + 1);
    if (paths.length === 0) return 'git add 没有指定路径';
    if (paths.includes('.')) return 'git add 使用了 .';
    return null;
  }
  if (subcommand === 'commit') {
    if (hasShortFlag(args, 'a') || args.includes('--all')) return 'git commit 使用了 -a';
    return null;
  }
  if (subcommand === 'reset') {
    if (args.includes('--hard')) return 'git reset 使用了 --hard';
    return null;
  }
  if (['checkout', 'clean', 'restore', 'stash', 'revert'].includes(subcommand)) {
    return `git ${subcommand}`;
  }
  return null;
}

/** 读取 GIT_TRACE2_EVENT 记录的 git 调用。 */
function readGitTrace(tracePath) {
  if (!fs.existsSync(tracePath)) return [];
  const calls = [];
  for (const line of fs.readFileSync(tracePath, 'utf8').split(/\r\n|\n|\r/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (Array.isArray(event.argv)) calls.push(event.argv);
    } catch {
      // 忽略无法解析的追踪行。
    }
  }
  return calls;
}

/** 计算工作区全部文件的哈希，用于证明执行器没有改动工作区。 */
function worktreeDigest(repo) {
  const digest = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      digest.set(
        path.relative(repo, full).replace(/\\/g, '/'),
        createHash('sha256').update(fs.readFileSync(full)).digest('hex'),
      );
    }
  };
  walk(repo);
  return digest;
}

function testExecutorNeverModifiesWorktreeOrRunsForbiddenGit() {
  /**
   * Given：一个包含两处语义改动的仓库，执行器运行期间开启 git 调用追踪。
   * When：执行两步语义计划。
   * Then：工作区文件哈希完全不变，暂存区为空，且没有出现 git add .、commit -a、reset --hard 或 checkout。
   防回归：执行器必须只写 index，并且不得使用会丢失工作区内容的 Git 命令。
   */
  return withRepo('git-up-sem-invariant-', (work, repo) => {
    const base = Array.from({ length: 20 }, (_, index) => `l${index + 1}`).join('\n') + '\n';
    writeFile(path.join(repo, 'code.txt'), base);
    writeFile(path.join(repo, 'other.txt'), 'other\n');
    git(repo, 'add', 'code.txt', 'other.txt');
    git(repo, 'commit', '-m', 'init');
    const changed = base.split('\n');
    changed[2] = 'L3';
    changed[14] = 'L15';
    writeFile(path.join(repo, 'code.txt'), changed.join('\n'));

    const diffPath = path.join(work, 'full.patch');
    writeFile(diffPath, git(repo, 'diff', '-U1', '--', 'code.txt').stdout);
    const outDir = path.join(work, 'patches');
    const split = runCommand(
      [process.execPath, SPLIT_SCRIPT, '--diff', diffPath, '--out', outDir, '--prefix', 'inv'],
      PROJECT_ROOT,
    );
    const manifest = parseJson(split);
    const patches = manifest.files[0].hunks.map((hunk) => hunk.patch);

    const before = worktreeDigest(repo);
    const tracePath = path.join(work, 'trace.json');
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat(code): ✨第一处改动',
        changes: [{ path: 'code.txt', patch_file: patches[0] }],
      },
      {
        step: 2,
        subject: 'feat(code): ✨第二处改动',
        depends_on: [1],
        changes: [{ path: 'code.txt', patch_file: patches[1] }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo, null, { GIT_TRACE2_EVENT: tracePath });
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.completed_steps.length === 2, '应产生两个提交');

    const after = worktreeDigest(repo);
    assertTrue(before.size === after.size, '工作区文件数量不应改变');
    for (const [file, hash] of before) {
      assertTrue(after.get(file) === hash, `工作区文件不应被改动: ${file}`);
    }

    const staged = git(repo, 'diff', '--cached', '--name-only').stdout.trim();
    assertTrue(staged === '', `执行后暂存区应为空，实际 ${staged}`);

    const calls = readGitTrace(tracePath);
    const applied = calls.filter((argv) => argv[1] === 'apply' && argv.includes('--cached'));
    assertTrue(applied.length >= 2, `追踪应记录到每个步骤的 apply --cached 调用，实际 ${applied.length}`);

    const violations = [];
    for (const argv of calls) {
      const reason = forbiddenGitReason(argv);
      if (reason) violations.push(`${reason}: ${argv.slice(1).join(' ')}`);
    }
    assertTrue(violations.length === 0, `出现禁止的 git 调用: ${violations.join(' | ')}`);

    // 检测器自检。防止规则写坏后测试变成空断言。
    const detected = [
      ['git', 'add', '.'],
      ['git', 'add', '-A'],
      ['git', 'add', '--all'],
      ['git', 'add', '-A', '--all'],
      ['git', 'add', '-A', '.'],
      ['git', 'commit', '-a'],
      ['git', 'commit', '-am', 'msg'],
      ['git', 'commit', '--all'],
      ['git', 'reset', '--hard'],
      ['git', 'checkout', '--', 'x'],
      ['git', 'clean', '-fd'],
      ['git', 'restore', 'x'],
    ];
    for (const argv of detected) {
      assertTrue(forbiddenGitReason(argv) !== null, `检测器应拦下: ${argv.join(' ')}`);
    }
    const allowed = [
      ['git', 'add', '--', 'a.txt'],
      ['git', 'add', '-A', '--', 'a.txt', 'b.txt'],
      ['git', 'commit', '-F', 'message.txt'],
      ['git', 'commit', '-m', 'subject'],
      ['git', 'reset', '--quiet'],
      ['git', 'status', '--porcelain'],
      ['git', 'apply', '--cached', '--whitespace=nowarn', '-'],
    ];
    for (const argv of allowed) {
      assertTrue(forbiddenGitReason(argv) === null, `检测器不应拦下: ${argv.join(' ')}`);
    }
  });
}

function testFileModeNeverRunsForbiddenGit() {
  /**
   * Given：文件级计划执行期间开启 git 调用追踪。
   * When：执行只列出计划内文件的提交计划。
   * Then：没有出现禁止的 git 调用，工作区未跟踪文件保持不变。
   防回归：兼容的文件级模式也必须遵守同一组安全约束。
   */
  return withRepo('git-up-sem-invariant-file-', (work, repo) => {
    writeFile(path.join(repo, 'README.md'), '# test\n');
    git(repo, 'add', 'README.md');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'planned.txt'), 'planned\n');
    writeFile(path.join(repo, 'untracked.txt'), 'untracked\n');

    const tracePath = path.join(work, 'trace.json');
    const yamlText = `- step: 1
  subject: "test(plan): 文件级模式"
  files:
    - planned.txt
`;
    const before = worktreeDigest(repo);
    const result = runPlan('commit', yamlText, repo, null, { GIT_TRACE2_EVENT: tracePath });
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.ok === true, '文件级提交应成功');
    const after = worktreeDigest(repo);
    for (const [file, hash] of before) {
      assertTrue(after.get(file) === hash, `工作区文件不应被改动: ${file}`);
    }
    const staged = git(repo, 'diff', '--cached', '--name-only').stdout.trim();
    assertTrue(staged === '', `执行后暂存区应为空，实际 ${staged}`);

    const violations = [];
    for (const argv of readGitTrace(tracePath)) {
      const reason = forbiddenGitReason(argv);
      if (reason) violations.push(`${reason}: ${argv.slice(1).join(' ')}`);
    }
    assertTrue(violations.length === 0, `出现禁止的 git 调用: ${violations.join(' | ')}`);
  });
}

function testSemanticCommitKeepsMessageBodyAndFoot() {
  /**
   * Given：语义步骤声明 subject、body 块和 foot。
   * When：执行语义计划并读取生成的提交信息。
   * Then：提交信息保留主题、多行正文和脚注，中文与 emoji 不被替换。
   防回归：语义模式不得改变既有的 commit message 约定。
   */
  return withRepo('git-up-sem-message-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'b.txt'), 'b\n');
    const state = path.join(work, 'state.txt');
    writeFile(state, 'b\n');
    const yamlText = `- step: 1
  subject: "feat(core): ✨语义提交"
  body: |
    - 新增语义拆分能力
    - 校验最终状态一致
  foot: "Refs: #42"
  changes:
    - path: b.txt
      patch_mode: content
      patch_file: ${state}
`;
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    const message = git(repo, 'log', '-1', '--format=%B').stdout;
    assertTrue(message.includes('feat(core): ✨语义提交'), '主题应保留中文与 emoji');
    assertTrue(message.includes('- 新增语义拆分能力'), '正文应保留');
    assertTrue(message.includes('- 校验最终状态一致'), '多行正文应完整保留');
    assertTrue(message.includes('Refs: #42'), '脚注应保留');
    assertTrue(payload.completed_steps[0].subject === 'feat(core): ✨语义提交', '结果应报告主题');
  });
}

function testStageAppliesThreeWayPatch() {
  /**
   * Given：第二个补丁的上下文已被第一个提交改动，普通应用无法匹配。
   * When：第二步使用 3way 补丁模式暂存。
   Then：Git 用基准 blob 完成三方合并，两个改动都进入最终提交。
   防回归：3way 模式必须可用，且不得把冲突静默写入提交。
   */
  return withRepo('git-up-sem-3way-', (work, repo) => {
    const base = Array.from({ length: 20 }, (_, index) => `l${index + 1}`).join('\n') + '\n';
    writeFile(path.join(repo, 'f.txt'), base);
    git(repo, 'add', 'f.txt');
    git(repo, 'commit', '-m', 'init');

    const buildPatch = (name, line) => {
      const changed = base.split('\n');
      changed[line - 1] = `L${line}`;
      writeFile(path.join(repo, 'f.txt'), changed.join('\n'));
      const diffPath = path.join(work, `${name}.diff`);
      writeFile(diffPath, git(repo, 'diff', '-U3', '--', 'f.txt').stdout);
      writeFile(path.join(repo, 'f.txt'), base);
      // 用随 skill 提供的拆分脚本生成单 hunk 补丁。
      const outDir = path.join(work, `${name}-patches`);
      const split = runCommand(
        [process.execPath, SPLIT_SCRIPT, '--diff', diffPath, '--out', outDir, '--prefix', name],
        PROJECT_ROOT,
      );
      assertTrue(split.status === 0, `拆分补丁失败: ${split.stderr}`);
      const manifest = parseJson(split);
      assertTrue(manifest.patch_count === 1, `应拆出一个补丁，实际 ${manifest.patch_count}`);
      return manifest.files[0].hunks[0].patch;
    };

    const patchOne = buildPatch('p1', 13);
    const patchTwo = buildPatch('p2', 15);

    // 工作区保留两处改动，作为目标状态。
    const changed = base.split('\n');
    changed[12] = 'L13';
    changed[14] = 'L15';
    writeFile(path.join(repo, 'f.txt'), changed.join('\n'));

    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat(f): ✨第一处改动',
        changes: [{ path: 'f.txt', patch_mode: 'patch', patch_file: patchOne }],
      },
      {
        step: 2,
        subject: 'feat(f): ✨第二处改动',
        depends_on: [1],
        changes: [{ path: 'f.txt', patch_mode: '3way', patch_file: patchTwo }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.completed_steps.length === 2, '应产生两个提交');
    const content = git(repo, 'show', 'HEAD:f.txt').stdout;
    assertTrue(content.includes('L13'), '第一个改动应保留');
    assertTrue(content.includes('L15'), '第二个改动应通过三方合并进入提交');
    assertTrue(payload.verification.ok === true, '最终校验应通过');
  });
}

function testStageSplitsAdjacentEditsThroughIntermediateState() {
  /**
   * Given：JSON 文件中两处相邻的改动无法用 hunk 表达语义边界。
   * When：执行器使用 content 模式的中间状态文件分两步暂存。
   * Then：两个提交分别只包含各自的语义改动，最终内容等于目标。
   * 防回归：结构化文件的相邻改动必须仍可拆分。
   */
  return withRepo('git-up-sem-inter-', (work, repo) => {
    const base = '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n';
    const final = '{\n  "name":  "demo",\n  "version": "1.0.0",\n  "scripts": {\n    "build": "tsc"\n  }\n}\n';
    writeFile(path.join(repo, 'package.json'), base);
    git(repo, 'add', 'package.json');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'package.json'), final);

    const stateOne = path.join(work, 'state-1.json');
    const stateTwo = path.join(work, 'state-2.json');
    writeFile(stateOne, '{\n  "name": "demo",\n  "version": "1.0.0",\n  "scripts": {\n    "build": "tsc"\n  }\n}\n');
    writeFile(stateTwo, final);

    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'build(scripts): ✨增加脚本',
        changes: [{ path: 'package.json', patch_mode: 'content', patch_file: stateOne }],
      },
      {
        step: 2,
        subject: 'style(format): ✨统一格式',
        depends_on: [1],
        changes: [{ path: 'package.json', patch_mode: 'content', patch_file: stateTwo }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.completed_steps.length === 2, '应产生两个提交');
    const first = git(repo, 'show', 'HEAD~1:package.json').stdout;
    assertTrue(first.includes('"name": "demo"'), '第一个提交不应包含格式改动');
    assertTrue(first.includes('"build": "tsc"'), '第一个提交应包含脚本改动');
    const second = git(repo, 'show', 'HEAD:package.json').stdout;
    assertTrue(second.includes('"name":  "demo"'), '第二个提交应包含格式改动');
  });
}

function testStageReportsPatchConflict() {
  /**
   * Given：补丁的上下文与当前 HEAD 不匹配。
   * When：commit_plan.mjs commit 执行该语义计划。
   * Then：返回 patch_apply_failure，且不创建提交。
   * 防回归：补丁应用失败必须停止执行，不得静默扩大提交范围。
   */
  return withRepo('git-up-sem-conflict-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\ntwo\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'a.txt'), 'one\nchanged\n');
    const patch = path.join(work, 'conflict.patch');
    writeFile(
      patch,
      'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-one\n+uno\n missing\n',
    );
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: conflicting patch',
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    const before = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    const after = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    assertTrue(result.status === 1, '补丁冲突应返回失败');
    assertTrue(payload.code === 'patch_apply_failure', '错误码应为 patch_apply_failure');
    assertTrue(before === after, '补丁冲突时不应创建提交');
  });
}

function testStageHandlesWhitespace() {
  /**
   * Given：补丁新增一行带尾随空格的文本。
   * When：分别以默认 nowarn 与显式 error 两种空白策略执行。
   * Then：默认策略成功应用并提交；error 策略返回 patch_apply_failure。
   * 防回归：空白处理必须可控，且不得被静默忽略。
   */
  return withWork('git-up-sem-space-', (work) => {
    const patch = path.join(work, 'ws.patch');

    const repoOne = path.join(work, 'repo-one');
    fs.mkdirSync(repoOne, { recursive: true });
    initRepo(repoOne);
    writeFile(path.join(repoOne, 'w.txt'), 'w1\nw2\n');
    git(repoOne, 'add', 'w.txt');
    git(repoOne, 'commit', '-m', 'init');
    writeFile(path.join(repoOne, 'w.txt'), 'w1 \nw2\n');
    writeFile(patch, git(repoOne, 'diff', '--', 'w.txt').stdout);

    const okText = semanticPlan([
      {
        step: 1,
        subject: 'feat: whitespace patch',
        changes: [{ path: 'w.txt', patch_file: patch }],
      },
    ]);
    const okResult = runPlan('commit', okText, repoOne);
    const okPayload = parseJson(okResult);
    assertTrue(okResult.status === 0, `${okResult.stdout}${okResult.stderr}`);
    assertTrue(okPayload.ok === true, '默认空白策略应成功');

    const repoTwo = path.join(work, 'repo-two');
    fs.mkdirSync(repoTwo, { recursive: true });
    initRepo(repoTwo);
    writeFile(path.join(repoTwo, 'w.txt'), 'w1\nw2\n');
    git(repoTwo, 'add', 'w.txt');
    git(repoTwo, 'commit', '-m', 'init');
    writeFile(path.join(repoTwo, 'w.txt'), 'w1 \nw2\n');
    writeFile(patch, git(repoTwo, 'diff', '--', 'w.txt').stdout);

    const strictText = semanticPlan([
      {
        step: 1,
        subject: 'feat: strict whitespace',
        changes: [{ path: 'w.txt', patch_file: patch, whitespace: 'error' }],
      },
    ]);
    const strictResult = runPlan('commit', strictText, repoTwo);
    const strictPayload = parseJson(strictResult);
    assertTrue(strictResult.status === 1, 'error 空白策略应失败');
    assertTrue(strictPayload.code === 'patch_apply_failure', '错误码应为 patch_apply_failure');
  });
}

function testStageReportsEmptyGroupAsSkipped() {
  /**
   * Given：一个语义步骤的补丁文件为空，不产生任何实际改动。
   * When：commit_plan.mjs commit 执行该语义计划。
   * Then：该步骤被报告为 skipped，且不创建提交。
   * 防回归：重复或已被覆盖的补丁必须可见，不得当成成功提交。
   */
  return withRepo('git-up-sem-empty-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    const patch = path.join(work, 'empty.patch');
    writeFile(patch, '');
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: empty group',
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    const before = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    const after = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.ok === true, '空语义组不应让整次执行失败');
    assertTrue(payload.skipped_steps.length === 1, '空语义组应被报告为 skipped');
    assertTrue(payload.skipped_steps[0].step === 1, '跳过的步骤号应正确');
    assertTrue(before === after, '空语义组不应创建提交');
  });
}

function testStageRejectsOutOfScopePatch() {
  /**
   * Given：步骤声明的路径是 a.txt，但补丁实际修改 b.txt。
   * When：commit_plan.mjs commit 执行该语义计划。
   * Then：返回 patch_scope_mismatch，且不创建提交。
   * 防回归：提交范围必须由计划显式声明，执行器不得替计划扩大范围。
   */
  return withRepo('git-up-sem-scope-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    writeFile(path.join(repo, 'b.txt'), 'two\n');
    git(repo, 'add', 'a.txt', 'b.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'b.txt'), 'two changed\n');
    const patch = path.join(work, 'other.patch');
    writeFile(patch, git(repo, 'diff', '--', 'b.txt').stdout);
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: wrong scope',
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    const before = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    const after = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    assertTrue(result.status === 1, '越界补丁应返回失败');
    assertTrue(payload.code === 'patch_scope_mismatch', '错误码应为 patch_scope_mismatch');
    assertTrue(before === after, '越界补丁不应创建提交');
  });
}

function testStageRejectsUnsupportedOperations() {
  /**
   * Given：补丁内容是 Git 的二进制补丁格式。
   * When：commit_plan.mjs commit 执行该语义计划。
   * Then：返回 unsupported_operation，且不创建提交。
   * 防回归：二进制改动必须显式支持，执行器不得猜测。
   */
  return withRepo('git-up-sem-binary-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeBytes(path.join(repo, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const patch = path.join(work, 'binary.patch');
    writeFile(
      patch,
      'diff --git a/img.png b/img.png\nindex 1111111..2222222 100644\nGIT binary patch\nliteral 12\n',
    );
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: binary patch',
        changes: [{ path: 'img.png', patch_file: patch }],
      },
    ]);
    const before = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    const after = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    assertTrue(result.status === 1, `二进制补丁应返回失败，实际 ${result.stdout}`);
    assertTrue(payload.code === 'unsupported_operation', `错误码应为 unsupported_operation，实际 ${payload.code}`);
    assertTrue(before === after, '二进制补丁不应创建提交');
  });
}

// ---------------------------------------------------------------------------
// 执行测试
// ---------------------------------------------------------------------------
function testExecutionFollowsDependencyOrder() {
  /**
   * Given：计划中后声明的步骤是前一个步骤的前置依赖。
   * When：commit_plan.mjs commit 执行该语义计划。
   * Then：提交顺序遵循 depends_on，而不是计划中的书写顺序。
   * 防回归：依赖顺序是语义提交的核心契约。
   */
  return withRepo('git-up-sem-order-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    writeFile(path.join(repo, 'b.txt'), 'two\n');
    git(repo, 'add', 'a.txt', 'b.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'a.txt'), 'one changed\n');
    writeFile(path.join(repo, 'b.txt'), 'two changed\n');
    const patchA = path.join(work, 'a.patch');
    const patchB = path.join(work, 'b.patch');
    writeFile(patchA, git(repo, 'diff', '--', 'a.txt').stdout);
    writeFile(patchB, git(repo, 'diff', '--', 'b.txt').stdout);

    const yamlText = semanticPlan([
      {
        step: 2,
        subject: 'feat(b): 依赖先提交',
        depends_on: [1],
        changes: [{ path: 'b.txt', patch_file: patchB }],
      },
      {
        step: 1,
        subject: 'feat(a): 前置提交',
        changes: [{ path: 'a.txt', patch_file: patchA }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    const order = payload.completed_steps.map((item) => item.step);
    assertTrue(order.join(',') === '1,2', `提交顺序应遵循依赖，实际 ${order.join(',')}`);
    const log = git(repo, 'log', '--oneline', '-2').stdout.split(/\r\n|\n|\r/).filter(Boolean);
    assertTrue(log[1].includes('feat(a)'), '较早的提交应是步骤 1');
  });
}

function testExecutionRejectsNonEmptyIndex() {
  /**
   * Given：执行前暂存区已有用户预先暂存的内容。
   * When：commit_plan.mjs commit 执行语义计划。
   * Then：返回 staged_changes_present，且不创建提交。
   * 防回归：语义执行器不得绕过暂存区保护。
   */
  return withRepo('git-up-sem-staged-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'staged.txt'), 'staged\n');
    git(repo, 'add', 'staged.txt');
    writeFile(path.join(repo, 'a.txt'), 'one changed\n');
    const patch = path.join(work, 'a.patch');
    writeFile(patch, git(repo, 'diff', '--', 'a.txt').stdout);
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: staged guard',
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    const before = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    const after = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    assertTrue(result.status === 1, '已有暂存内容时应拒绝执行');
    assertTrue(payload.code === 'staged_changes_present', '错误码应为 staged_changes_present');
    assertTrue(before === after, '拒绝执行时不应创建提交');
  });
}

function testExecutionKeepsUnrelatedFilesOutOfCommits() {
  /**
   * Given：仓库中同时存在计划内文件和计划外的未跟踪文件。
   * When：commit_plan.mjs commit 执行语义计划。
   * Then：提交只包含计划内文件，计划外文件保持未跟踪。
   * 防回归：语义拆分不得把无关改动带进提交。
   */
  return withRepo('git-up-sem-unrelated-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'a.txt'), 'one changed\n');
    writeFile(path.join(repo, 'unrelated.txt'), 'unrelated\n');
    const patch = path.join(work, 'a.patch');
    writeFile(patch, git(repo, 'diff', '--', 'a.txt').stdout);
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: only planned file',
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    const committed = git(repo, 'show', '--name-only', '--format=', 'HEAD').stdout;
    assertTrue(committed.includes('a.txt'), '计划内文件应进入提交');
    assertTrue(!committed.includes('unrelated.txt'), '计划外文件不得进入提交');
    const status = git(repo, 'status', '--porcelain').stdout;
    assertTrue(status.includes('unrelated.txt'), '计划外文件应保持未跟踪');
  });
}

function testExecutionReportsCommitFailure() {
  /**
   * Given：仓库的 pre-commit 钩子拒绝任何提交。
   * When：commit_plan.mjs commit 执行语义计划。
   * Then：返回 commit_failure，且不创建提交。
   * 防回归：钩子拒绝必须停止执行，不得忽略。
   */
  return withRepo('git-up-sem-hook-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(
      path.join(repo, '.git', 'hooks', 'pre-commit'),
      '#!/bin/sh\necho "hook rejected" >&2\nexit 1\n',
    );
    writeFile(path.join(repo, 'a.txt'), 'one changed\n');
    const patch = path.join(work, 'a.patch');
    writeFile(patch, git(repo, 'diff', '--', 'a.txt').stdout);
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: hook rejects',
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    const before = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    const after = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    assertTrue(result.status === 1, `钩子拒绝时应返回失败，实际 ${result.stdout}`);
    assertTrue(payload.code === 'commit_failure', `错误码应为 commit_failure，实际 ${payload.code}`);
    assertTrue(before === after, '钩子拒绝时不应创建提交');
  });
}

// ---------------------------------------------------------------------------
// 快照与校验测试
// ---------------------------------------------------------------------------
function testVerificationCoversTrackedModification() {
  /**
   * Given：计划修改一个已跟踪文件。
   * When：执行语义计划并完成校验。
   * Then：校验通过，最终 HEAD 树与目标树一致。
   * 防回归：已跟踪文件的改动必须被最终校验覆盖。
   */
  return withRepo('git-up-sem-ver-mod-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'a.txt'), 'one changed\n');
    const patch = path.join(work, 'a.patch');
    writeFile(patch, git(repo, 'diff', '--', 'a.txt').stdout);
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: tracked modification',
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.verification.ok === true, '校验应通过');
    assertTrue(payload.verification.tree_match === true, '最终树应与目标树一致');
    assertTrue(payload.final_tree === payload.target_tree, '报告的树应一致');
  });
}

function testVerificationCoversUntrackedAddition() {
  /**
   * Given：计划把一个未跟踪的新文件纳入提交。
   * When：执行语义计划并完成校验。
   * Then：校验通过，且新文件出现在提交中。
   * 防回归：新增文件必须被最终校验覆盖。
   */
  return withRepo('git-up-sem-ver-add-', (work, repo) => {
    writeFile(path.join(repo, 'seed.txt'), 'seed\n');
    git(repo, 'add', 'seed.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'new.txt'), 'new content\n');
    const content = path.join(work, 'new.state');
    writeFile(content, 'new content\n');
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: add new file',
        changes: [{ path: 'new.txt', patch_mode: 'content', patch_file: content }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.verification.ok === true, '校验应通过');
    const tracked = git(repo, 'ls-tree', '--name-only', 'HEAD').stdout;
    assertTrue(tracked.includes('new.txt'), '新增文件应进入提交');
  });
}

function testVerificationCoversDeletion() {
  /**
   * Given：计划删除一个已跟踪文件。
   * When：执行语义计划并完成校验。
   * Then：校验通过，且该文件从提交树中消失。
   * 防回归：删除操作必须被最终校验覆盖。
   */
  return withRepo('git-up-sem-ver-del-', (work, repo) => {
    writeFile(path.join(repo, 'keep.txt'), 'keep\n');
    writeFile(path.join(repo, 'gone.txt'), 'gone\n');
    git(repo, 'add', 'keep.txt', 'gone.txt');
    git(repo, 'commit', '-m', 'init');
    fs.rmSync(path.join(repo, 'gone.txt'));
    const patch = path.join(work, 'del.patch');
    writeFile(patch, git(repo, 'diff', '--', 'gone.txt').stdout);
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'chore: remove file',
        changes: [{ path: 'gone.txt', patch_file: patch }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.verification.ok === true, '校验应通过');
    const tracked = git(repo, 'ls-tree', '--name-only', 'HEAD').stdout;
    assertTrue(!tracked.includes('gone.txt'), '被删除的文件不应留在提交树中');
  });
}

function testVerificationCoversBinaryFile() {
  /**
   * Given：计划修改一个二进制文件，内容通过中间状态文件提供。
   * When：执行语义计划并完成校验。
   * Then：校验通过，且提交中的二进制内容与目标字节一致。
   * 防回归：二进制改动必须被最终校验覆盖。
   */
  return withRepo('git-up-sem-ver-bin-', (work, repo) => {
    const original = Buffer.from(Array.from({ length: 256 }, (_, index) => index).flatMap((v) => [v, v, v, v]));
    const updated = Buffer.from(Array.from({ length: 256 }, (_, index) => 255 - index).flatMap((v) => [v, v, v, v]));
    writeBytes(path.join(repo, 'blob.bin'), original);
    git(repo, 'add', 'blob.bin');
    git(repo, 'commit', '-m', 'init');
    writeBytes(path.join(repo, 'blob.bin'), updated);
    const content = path.join(work, 'blob.state');
    writeBytes(content, updated);
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: binary update',
        changes: [{ path: 'blob.bin', patch_mode: 'content', patch_file: content }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.verification.ok === true, '校验应通过');
    const committed = gitBuffer(repo, 'show', 'HEAD:blob.bin');
    assertTrue(
      Buffer.compare(committed.stdout, updated) === 0,
      '提交中的二进制内容应与目标字节一致',
    );
  });
}

function testVerificationDetectsTargetMismatch() {
  /**
   * Given：工作区有两处改动，而计划只覆盖其中一处。
   * When：执行语义计划并完成校验。
   * Then：返回 target_verification_failure。
   * 防回归：不完整的拆分不得被报告为成功。
   */
  return withRepo('git-up-sem-ver-mis-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'a.txt'), 'ONE\ntwo\nthree\nfour\nFIVE\n');
    const patches = splitDiffIntoPatches(repo, 'a.txt', path.join(work, 'patches'), 'part');
    assertTrue(patches.length === 2, `应拆出两个补丁，实际 ${patches.length}`);
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat: only first part',
        changes: [{ path: 'a.txt', patch_file: patches[0] }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 1, `目标不一致时应返回失败，实际 ${result.stdout}`);
    assertTrue(payload.code === 'target_verification_failure', '错误码应为 target_verification_failure');
    assertTrue(payload.verification.ok === false, '校验应标记为失败');
  });
}

// ---------------------------------------------------------------------------
// 快车道回退测试
// ---------------------------------------------------------------------------
function testFastPathBypassedForEverySemanticCondition() {
  /**
   * Given：多种需要语义拆分的计划，分别声明 changes、共享路径、依赖、补丁或不支持的操作。
   * When：inspect_fast_path.mjs 读取计划并做硬条件筛选。
   * Then：每种情况都回退快车道，并报告对应的原因。
   * 防回归：精度不得被速度换掉。
   */
  return withRepo('git-up-sem-fast-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'a.txt'), 'one changed\n');

    const patch = path.join(work, 's.patch');
    writeFile(patch, git(repo, 'diff', '--', 'a.txt').stdout);
    const binaryPatch = path.join(work, 'b.patch');
    writeFile(binaryPatch, 'diff --git a/a.txt b/a.txt\nGIT binary patch\nliteral 4\n');

    const plans = {
      changes_present: [
        {
          step: 1,
          subject: 'feat: changes',
          changes: [{ path: 'a.txt', patch_file: patch }],
        },
      ],
      shared_path_across_steps: [
        {
          step: 1,
          subject: 'feat: one',
          changes: [{ path: 'a.txt', patch_file: patch }],
        },
        {
          step: 2,
          subject: 'feat: two',
          changes: [{ path: 'a.txt', patch_file: patch }],
        },
      ],
      dependencies_present: [
        {
          step: 1,
          subject: 'feat: one',
          changes: [{ path: 'a.txt', patch_file: patch }],
        },
        {
          step: 2,
          subject: 'feat: two',
          depends_on: [1],
          changes: [{ path: 'a.txt', patch_file: patch }],
        },
      ],
      patch_files_present: [
        {
          step: 1,
          subject: 'feat: patch',
          changes: [{ path: 'a.txt', patch_file: patch }],
        },
      ],
      intermediate_states_present: [
        {
          step: 1,
          subject: 'feat: content',
          changes: [{ path: 'a.txt', patch_mode: 'content', patch_file: patch }],
        },
      ],
      unsupported_operations_present: [
        {
          step: 1,
          subject: 'feat: binary',
          changes: [{ path: 'a.txt', patch_file: binaryPatch }],
        },
      ],
    };

    for (const [expectedReason, steps] of Object.entries(plans)) {
      const planPath = path.join(work, `plan-${expectedReason}.yaml`);
      writeFile(planPath, semanticPlan(steps));
      const result = runFastPath(repo, planPath);
      const payload = parseJson(result);
      assertTrue(result.status === 0, result.stderr || result.stdout);
      assertTrue(payload.eligible === false, `${expectedReason} 必须回退快车道`);
      assertTrue(
        payload.fallback_reasons.includes(expectedReason),
        `${expectedReason} 应出现在回退原因中，实际 ${payload.fallback_reasons.join(',')}`,
      );
      assertTrue(payload.semantic_split_required === true, `${expectedReason} 应标记需要语义拆分`);
    }
  });
}

function testFastPathAllowsSimpleSingleStepPlan() {
  /**
   * Given：单步骤、只声明 files 的简单计划。
   * When：inspect_fast_path.mjs 读取计划并做硬条件筛选。
   * Then：eligible 为真，且不报告语义拆分原因。
   * 防回归：简单提交不得被无理由地降级。
   */
  return withRepo('git-up-sem-fast-ok-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'a.txt'), 'one changed\n');
    const planPath = path.join(work, 'simple.yaml');
    writeFile(planPath, '- step: 1\n  subject: "feat: simple"\n  files:\n    - a.txt\n');
    const result = runFastPath(repo, planPath);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(
      payload.eligible === true,
      `简单计划应命中快车道，原因 ${payload.fallback_reasons.join(',')}`,
    );
    assertTrue(payload.semantic_split_required === false, '简单计划不应要求语义拆分');
    assertTrue(payload.plan_mode === 'file', '应报告 file 模式');
  });
}

// ---------------------------------------------------------------------------
// 端到端验收测试
// ---------------------------------------------------------------------------
function testPackageJsonSplitsIntoThreeCommits() {
  /**
   * Given：package.json 同时包含依赖安装、格式调整和 scripts 增加三类改动。
   * When：执行器按三个语义步骤提交。
   * Then：产生三个独立提交，最终 HEAD 树与执行前的工作区目标一致。
   * 防回归：这是语义拆分的主验收场景。
   */
  return withRepo('git-up-sem-e2e-', (work, repo) => {
    const base = '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n';
    const final =
      '{\n  "name":  "demo",\n  "version": "1.0.0",\n' +
      '  "dependencies": {\n    "lodash": "^4.17.21"\n  },\n' +
      '  "scripts": {\n    "build": "tsc"\n  }\n}\n';
    writeFile(path.join(repo, 'package.json'), base);
    git(repo, 'add', 'package.json');
    git(repo, 'commit', '-m', 'init');
    const baseHead = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    writeFile(path.join(repo, 'package.json'), final);

    const stateDeps = path.join(work, 'state-deps.json');
    const stateFormat = path.join(work, 'state-format.json');
    const stateScripts = path.join(work, 'state-scripts.json');
    writeFile(
      stateDeps,
      '{\n  "name": "demo",\n  "version": "1.0.0",\n  "dependencies": {\n    "lodash": "^4.17.21"\n  }\n}\n',
    );
    writeFile(
      stateFormat,
      '{\n  "name":  "demo",\n  "version": "1.0.0",\n  "dependencies": {\n    "lodash": "^4.17.21"\n  }\n}\n',
    );
    writeFile(stateScripts, final);

    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'build(deps): ✨安装依赖',
        reason: '依赖必须先于脚本提交',
        changes: [{ path: 'package.json', patch_mode: 'content', patch_file: stateDeps }],
      },
      {
        step: 2,
        subject: 'style(format): ✨统一格式',
        reason: '格式调整与依赖无关',
        depends_on: [1],
        changes: [{ path: 'package.json', patch_mode: 'content', patch_file: stateFormat }],
      },
      {
        step: 3,
        subject: 'build(scripts): ✨增加构建脚本',
        reason: '脚本依赖已安装的依赖',
        depends_on: [2],
        changes: [{ path: 'package.json', patch_mode: 'content', patch_file: stateScripts }],
      },
    ]);
    const planPath = path.join(work, 'plan.yaml');
    writeFile(planPath, yamlText);

    const expectedTree = targetTreeOf(repo, baseHead, ['package.json']);
    const result = runPlanFile('commit', planPath, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    assertTrue(payload.ok === true, '执行应成功');
    assertTrue(payload.mode === 'semantic', '应使用语义模式');
    assertTrue(payload.completed_steps.length === 3, '应产生三个提交');

    const steps = payload.completed_steps.map((item) => item.step);
    assertTrue(steps.join(',') === '1,2,3', `提交顺序应为 1,2,3，实际 ${steps.join(',')}`);
    for (const item of payload.completed_steps) {
      assertTrue(item.sha, '每个提交都应报告 SHA');
      assertTrue(item.subject, '每个提交都应报告主题');
      assertTrue(
        item.paths.length === 1 && item.paths[0] === 'package.json',
        '每个提交都应报告路径',
      );
    }

    const finalTree = git(repo, 'rev-parse', 'HEAD^{tree}').stdout.trim();
    assertTrue(finalTree === expectedTree, '最终 HEAD 树应与执行前的工作区目标一致');
    assertTrue(payload.final_tree === expectedTree, '执行结果报告的最终树应一致');
    assertTrue(payload.verification.ok === true, '最终校验应通过');

    const content = git(repo, 'show', 'HEAD:package.json').stdout;
    assertTrue(content === final, '提交内容应等于目标内容');
    assertTrue(
      fs.readFileSync(path.join(repo, 'package.json'), 'utf8') === final,
      '工作区文件不应被改动',
    );
    const status = git(repo, 'status', '--porcelain').stdout.trim();
    assertTrue(status === '', `执行后工作区应干净，实际 ${status}`);

    const log = git(repo, 'log', '--oneline', '-3').stdout.split(/\r\n|\n|\r/).filter(Boolean);
    assertTrue(log[2].includes('build(deps)'), '最早的提交应是依赖提交');
    assertTrue(log[1].includes('style(format)'), '中间的提交应是格式提交');
    assertTrue(log[0].includes('build(scripts)'), '最新的提交应是脚本提交');
  });
}

function testResultContractSupportsDelegationAudit() {
  /**
   * Given：语义计划执行成功。
   * When：读取执行结果 JSON。
   * Then：结果包含步骤号、SHA、主题、路径和校验状态，可供委派场景审计。
   * 防回归：委派契约只依赖计划与结果的边界，边界字段不得缺失。
   */
  return withRepo('git-up-sem-contract-', (work, repo) => {
    writeFile(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'init');
    writeFile(path.join(repo, 'a.txt'), 'one changed\n');
    const patch = path.join(work, 'a.patch');
    writeFile(patch, git(repo, 'diff', '--', 'a.txt').stdout);
    const yamlText = semanticPlan([
      {
        step: 1,
        subject: 'feat(core): ✨契约',
        changes: [{ path: 'a.txt', patch_file: patch }],
      },
    ]);
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${result.stdout}${result.stderr}`);
    for (const field of ['ok', 'mode', 'completed_steps', 'skipped_steps', 'verification', 'git_log']) {
      assertTrue(field in payload, `结果应包含 ${field}`);
    }
    const commit = payload.completed_steps[0];
    for (const field of ['step', 'sha', 'subject', 'paths', 'status']) {
      assertTrue(field in commit, `提交记录应包含 ${field}`);
    }
    assertTrue(payload.verification.status === 'verified', '校验状态应可读');
    assertTrue(payload.base_head, '结果应记录基线 HEAD');
    assertTrue(payload.final_head, '结果应记录最终 HEAD');
  });
}

const TESTS = [
  testParseFilePlanStaysCompatible,
  testParseSemanticPlanReadsChanges,
  testParseSemanticPlanAllowsRepeatedPaths,
  testParseSemanticPlanReadsDependencies,
  testParseRejectsMalformedChanges,
  testParseRejectsInvalidPatchReference,
  testParseRejectsSemanticStepWithoutChanges,
  testParseRejectsSemanticStepDeclaringFiles,
  testParseRejectsScalarDependsOn,
  testSemanticModeHandlesNonAsciiPath,
  testFailureLeavesIndexClean,
  testPatchBodyLinesAreNotMistakenForHeaders,
  testEmptyPatchIsReportedAsSkipped,
  testBrokenIndexIsReportedAsFailure,
  testStagedDiffStateReportsGitFailure,
  testParseRejectsDependencyCycle,
  testSplitPatchProducesOneFilePerHunk,
  testSplitPatchReportsBinaryFiles,
  testStageSplitsOneFileIntoTwoCommits,
  testStageAppliesThreeWayPatch,
  testSemanticCommitKeepsMessageBodyAndFoot,
  testExecutorNeverModifiesWorktreeOrRunsForbiddenGit,
  testFileModeNeverRunsForbiddenGit,
  testStageSplitsAdjacentEditsThroughIntermediateState,
  testStageReportsPatchConflict,
  testStageHandlesWhitespace,
  testStageReportsEmptyGroupAsSkipped,
  testStageRejectsOutOfScopePatch,
  testStageRejectsUnsupportedOperations,
  testExecutionFollowsDependencyOrder,
  testExecutionRejectsNonEmptyIndex,
  testExecutionKeepsUnrelatedFilesOutOfCommits,
  testExecutionReportsCommitFailure,
  testVerificationCoversTrackedModification,
  testVerificationCoversUntrackedAddition,
  testVerificationCoversDeletion,
  testVerificationCoversBinaryFile,
  testVerificationDetectsTargetMismatch,
  testFastPathBypassedForEverySemanticCondition,
  testFastPathAllowsSimpleSingleStepPlan,
  testPackageJsonSplitsIntoThreeCommits,
  testResultContractSupportsDelegationAudit,
  testReasonIsNotWrittenIntoCommitMessage,
  testFailedExecutionReportsOnlyRealCommits,
];

async function main() {
  const failures = [];
  for (const test of TESTS) {
    try {
      await test();
      console.log(`PASS ${test.name}`);
    } catch (error) {
      const message = `FAIL ${test.name}: ${error?.message ?? error}`;
      failures.push(message);
      console.log(message);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join('\n')}\n`);
    return 1;
  }
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
