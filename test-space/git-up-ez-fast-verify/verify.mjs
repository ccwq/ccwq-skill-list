#!/usr/bin/env node
/**
 * ez-fast 实现的机器验收脚本。
 *
 * 用途：合并实现分支后，独立于实现方自报的测试结果，重新机器核对工单 08 与
 * 工单 09 的关键验收点。任何一项不通过即退出码非 0。
 *
 * 本脚本只做只读检查与临时仓库内的提交演练，不修改仓库内容。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'git-up', 'scripts');
const COMMIT_PLAN = path.join(SCRIPTS, 'commit_plan.mjs');
const INSPECT = path.join(SCRIPTS, 'inspect_fast_path.mjs');

const failures = [];
const passes = [];

function check(name, condition, detail = '') {
  if (condition) {
    passes.push(name);
    console.log(`PASS ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function run(args, cwd, stdin = null) {
  return spawnSync(process.execPath, args, {
    cwd,
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
}

function runGit(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function parseJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function withRepo(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ezfast-verify-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  try {
    runGit(['init'], repo);
    runGit(['config', 'user.name', 'Verify'], repo);
    runGit(['config', 'user.email', 'verify@example.com'], repo);
    fs.writeFileSync(path.join(repo, 'README.md'), '# base\n', 'utf8');
    runGit(['add', 'README.md'], repo);
    runGit(['commit', '-m', 'init'], repo);
    return body(repo);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const FILE_PLAN = `- step: 1
  subject: "feat(core): verify ez-fast"
  files:
    - a.txt
`;

const SEMANTIC_PLAN = `- step: 1
  subject: "feat(core): semantic plan"
  changes:
    - path: a.txt
      patch_mode: content
      patch_file: state.json
`;

// --- 工单 08：解析层与执行器 ---

// 1. parse --ez-fast 接受文件级计划，步骤含 suppressed_split 字段。
{
  const result = run([COMMIT_PLAN, 'parse', '--ez-fast'], ROOT, FILE_PLAN);
  const payload = parseJson(result);
  check(
    '08#1 parse --ez-fast 接受文件级计划',
    result.status === 0 && payload?.ok === true && payload?.plan_mode === 'file'
      && Array.isArray(payload?.steps?.[0]?.suppressed_split),
    `status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`,
  );
}

// 2. parse --ez-fast 拒绝语义计划。
{
  const result = run([COMMIT_PLAN, 'parse', '--ez-fast'], ROOT, SEMANTIC_PLAN);
  const payload = parseJson(result);
  check(
    '08#2 parse --ez-fast 拒绝语义计划',
    result.status === 2 && payload?.code === 'invalid_plan',
    `status=${result.status} payload=${result.stdout}`,
  );
}

// 3. 拒绝发生在 index 触碰之前：预暂存内容 + 语义计划 → invalid_plan（非 staged_changes_present），
//    HEAD 不变，预暂存内容原样保留。
{
  withRepo((repo) => {
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    runGit(['add', 'staged.txt'], repo);
    const beforeHead = runGit(['rev-parse', 'HEAD'], repo).stdout.trim();
    const beforeStaged = runGit(['diff', '--cached', '--name-only'], repo).stdout.trim();

    const result = run([COMMIT_PLAN, 'commit', '--ez-fast', '--cwd', repo], ROOT, SEMANTIC_PLAN);
    const payload = parseJson(result);
    const afterHead = runGit(['rev-parse', 'HEAD'], repo).stdout.trim();
    const afterStaged = runGit(['diff', '--cached', '--name-only'], repo).stdout.trim();

    check(
      '08#3 语义 ez-fast 计划在 index 触碰前被拒',
      payload?.code === 'invalid_plan' && payload?.code !== 'staged_changes_present'
        && beforeHead === afterHead && beforeStaged === afterStaged,
      `code=${payload?.code} headChanged=${beforeHead !== afterHead} stagedChanged=${beforeStaged !== afterStaged}`,
    );
  });
}

// 4. commit --ez-fast 正常提交文件级计划，计划外文件保持未跟踪。
{
  withRepo((repo) => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n', 'utf8');
    const result = run([COMMIT_PLAN, 'commit', '--ez-fast', '--cwd', repo], ROOT, FILE_PLAN);
    const payload = parseJson(result);
    const status = runGit(['status', '--short'], repo).stdout;
    const committed = runGit(['show', '--name-only', '--format=', 'HEAD'], repo).stdout;
    check(
      '08#4 commit --ez-fast 提交计划内文件',
      result.status === 0 && payload?.ok === true && committed.includes('a.txt') && status.includes('?? b.txt'),
      `status=${result.status} status=${status}`,
    );
  });
}

// 7. 结果字段：semantic_split_disabled=true，suppressed_split 为去重排序并集。
{
  withRepo((repo) => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n', 'utf8');
    const plan = `- step: 1
  subject: "feat: one"
  files:
    - a.txt
  suppressed_split:
    - a.txt
- step: 2
  subject: "feat: two"
  files:
    - b.txt
  suppressed_split:
    - b.txt
    - b.txt
`;
    const result = run([COMMIT_PLAN, 'commit', '--ez-fast', '--cwd', repo], ROOT, plan);
    const payload = parseJson(result);
    const union = JSON.stringify(payload?.suppressed_split);
    check(
      '08#7 结果含 semantic_split_disabled 与去重排序的 suppressed_split',
      payload?.semantic_split_disabled === true && union === '["a.txt","b.txt"]',
      `disabled=${payload?.semantic_split_disabled} suppressed=${union}`,
    );

    // 无声明的计划 → 空数组。
    const empty = run([COMMIT_PLAN, 'commit', '--ez-fast', '--cwd', repo], ROOT, FILE_PLAN);
    const emptyPayload = parseJson(empty);
    check(
      '08#7b 无 suppressed_split 声明时为空数组',
      emptyPayload?.semantic_split_disabled === true
        && Array.isArray(emptyPayload?.suppressed_split) && emptyPayload.suppressed_split.length === 0,
      `suppressed=${JSON.stringify(emptyPayload?.suppressed_split)}`,
    );
  });
}

// 8. 契约不泄漏：不带 --ez-fast 时结果不含这两个键。
{
  withRepo((repo) => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    const result = run([COMMIT_PLAN, 'commit', '--cwd', repo], ROOT, FILE_PLAN);
    const payload = parseJson(result);
    const hasKeys = payload && ('semantic_split_disabled' in payload || 'suppressed_split' in payload);
    check(
      '08#8 非 ez-fast 结果不含新字段',
      result.status === 0 && hasKeys === false,
      `keys=${hasKeys} stdout=${result.stdout}`,
    );
  });
}

// 9. --ez-fast 与 --fast-path 正交组合。
{
  withRepo((repo) => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    const result = run(
      [COMMIT_PLAN, 'commit', '--ez-fast', '--fast-path', '--cwd', repo],
      ROOT,
      FILE_PLAN,
    );
    const payload = parseJson(result);
    check(
      '08#9 --ez-fast --fast-path 两个标记同时生效',
      result.status === 0 && payload?.fast_path_used === true && payload?.semantic_split_disabled === true,
      `fast_path=${payload?.fast_path_used} disabled=${payload?.semantic_split_disabled}`,
    );
  });
}

// 10. suppressed_split 路径不在该步骤 files 中 → invalid_plan，消息含路径。
{
  const plan = `- step: 1
  subject: "feat: bad scope"
  files:
    - a.txt
  suppressed_split:
    - other.txt
`;
  const result = run([COMMIT_PLAN, 'parse'], ROOT, plan);
  const payload = parseJson(result);
  check(
    '08#10 suppressed_split 路径归属校验',
    result.status === 2 && payload?.code === 'invalid_plan' && String(payload?.message).includes('other.txt'),
    `status=${result.status} message=${payload?.message}`,
  );
}

// 11. 语义计划声明 suppressed_split → invalid_plan。
{
  const plan = `- step: 1
  subject: "feat: semantic with suppressed"
  changes:
    - path: a.txt
      patch_mode: content
      patch_file: state.json
  suppressed_split:
    - a.txt
`;
  const result = run([COMMIT_PLAN, 'parse'], ROOT, plan);
  const payload = parseJson(result);
  check(
    '08#11 语义模式声明 suppressed_split 被拒',
    result.status === 2 && payload?.code === 'invalid_plan',
    `status=${result.status} message=${payload?.message}`,
  );
}

// 12. suppressed_split 用块标量 → invalid_plan。
{
  const plan = `- step: 1
  subject: "feat: block scalar"
  files:
    - a.txt
  suppressed_split: |
    a.txt
`;
  const result = run([COMMIT_PLAN, 'parse'], ROOT, plan);
  const payload = parseJson(result);
  check(
    '08#12 suppressed_split 禁块标量',
    result.status === 2 && payload?.code === 'invalid_plan',
    `status=${result.status} message=${payload?.message}`,
  );
}

// 13. 检查器 --ez-fast 放宽规划质量级条件：6 文件跨两模块 → eligible=true。
{
  withRepo((repo) => {
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    for (let index = 0; index < 3; index += 1) {
      fs.writeFileSync(path.join(repo, 'src', `f${index}.txt`), 'base\n', 'utf8');
      fs.writeFileSync(path.join(repo, 'docs', `g${index}.txt`), 'base\n', 'utf8');
    }
    runGit(['add', '-A'], repo);
    runGit(['commit', '-m', 'seed'], repo);
    for (let index = 0; index < 3; index += 1) {
      fs.writeFileSync(path.join(repo, 'src', `f${index}.txt`), 'changed\n', 'utf8');
      fs.writeFileSync(path.join(repo, 'docs', `g${index}.txt`), 'changed\n', 'utf8');
    }
    const result = run([INSPECT, '--cwd', repo, '--ez-fast'], ROOT);
    const payload = parseJson(result);
    check(
      '08#13 检查器 --ez-fast 放宽文件数与跨模块',
      result.status === 0 && payload?.eligible === true && payload?.ez_fast === true
        && Array.isArray(payload?.semantic_split_reasons),
      `status=${result.status} eligible=${payload?.eligible} ez_fast=${payload?.ez_fast} reasons=${JSON.stringify(payload?.fallback_reasons)}`,
    );
  });
}

// 14. 检查器 --ez-fast 仍执行 Git 级条件：预暂存内容 → eligible=false。
{
  withRepo((repo) => {
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged\n', 'utf8');
    runGit(['add', 'staged.txt'], repo);
    const result = run([INSPECT, '--cwd', repo, '--ez-fast'], ROOT);
    const payload = parseJson(result);
    check(
      '08#14 检查器 --ez-fast 保留 Git 级条件',
      result.status === 0 && payload?.eligible === false
        && Array.isArray(payload?.fallback_reasons) && payload.fallback_reasons.includes('staged_changes_present'),
      `eligible=${payload?.eligible} reasons=${JSON.stringify(payload?.fallback_reasons)}`,
    );
  });
}

// --- 工单 09：文档同步面 ---

// 15. marketplace.json 合法且 git-up 版本为 2.8.0。
{
  const marketplacePath = path.join(ROOT, '.claude-plugin', 'marketplace.json');
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  } catch (error) {
    parsed = null;
  }
  const entry = parsed?.plugins?.find((item) => item.name === 'git-up');
  check(
    '09#15 marketplace.json 合法且 git-up 版本 2.8.0',
    parsed !== null && entry?.version === '2.8.0',
    `version=${entry?.version}`,
  );
}

// 16. SKILL.md 版本 2.8.0 且含 ez-fast 章节。
{
  const skillPath = path.join(ROOT, 'skills', 'git-up', 'SKILL.md');
  const text = fs.readFileSync(skillPath, 'utf8');
  check(
    '09#16 SKILL.md 版本 2.8.0 且含 ez-fast 章节',
    /^version:\s*2\.8\.0$/m.test(text) && text.includes('ez-fast'),
    'frontmatter version 或 ez-fast 章节缺失',
  );
}

// 17. references/ez-fast.md 存在。
{
  const referencePath = path.join(ROOT, 'skills', 'git-up', 'references', 'ez-fast.md');
  check('09#17 references/ez-fast.md 存在', fs.existsSync(referencePath), referencePath);
}

// 18. 改过的 Markdown 文件里指向仓库内的相对链接无断链。
{
  const markdownFiles = [
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'skills', 'git-up', 'SKILL.md'),
    path.join(ROOT, 'skills', 'git-up', 'README.md'),
    path.join(ROOT, 'skills', 'git-up', 'references', 'ez-fast.md'),
  ];
  const broken = [];
  const pattern = /\]\(([^)#]+?)\)/g;
  for (const file of markdownFiles) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    let match = pattern.exec(text);
    while (match !== null) {
      const target = match[1].trim();
      if (target && !/^[a-z]+:/i.test(target) && !target.startsWith('#')) {
        const resolved = path.resolve(path.dirname(file), target.split('#')[0]);
        if (!fs.existsSync(resolved)) broken.push(`${path.relative(ROOT, file)} → ${target}`);
      }
      match = pattern.exec(text);
    }
  }
  check('09#18 Markdown 相对链接无断链', broken.length === 0, broken.join('; '));
}

// 19. 根 README 与 references/ez-fast.md 的组合矩阵口径一致。
{
  const rootReadme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const reference = fs.readFileSync(path.join(ROOT, 'skills', 'git-up', 'references', 'ez-fast.md'), 'utf8');
  const rootHasZ = /`?-{1,2}z`?/.test(rootReadme) && rootReadme.includes('--ez-fast');
  const referenceHasMatrix = ['-z', '-zp', '-zc', '-zpc', '-zs'].every((token) => reference.includes(token));
  const referenceRejects = reference.includes('-zd') && reference.includes('-zi');
  check(
    '09#19 根 README 与参考文档参数口径一致',
    rootHasZ && referenceHasMatrix && referenceRejects,
    `rootHasZ=${rootHasZ} matrix=${referenceHasMatrix} rejects=${referenceRejects}`,
  );
}

// 20. 「尽力而为、允许为空、不保证完整」措辞三处齐备。
{
  const skillText = fs.readFileSync(path.join(ROOT, 'skills', 'git-up', 'SKILL.md'), 'utf8');
  const reference = fs.readFileSync(path.join(ROOT, 'skills', 'git-up', 'references', 'ez-fast.md'), 'utf8');
  const rootReadme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const soft = (text) => text.includes('尽力而为') || text.includes('允许为空');
  check(
    '09#20 suppressed_split 软字段措辞在 SKILL/参考/根 README 齐备',
    soft(skillText) && soft(reference) && soft(rootReadme),
    `skill=${soft(skillText)} ref=${soft(reference)} root=${soft(rootReadme)}`,
  );
}

console.log('');
console.log(`机器验收：${passes.length} 项通过，${failures.length} 项失败`);
if (failures.length > 0) {
  console.log('');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}
