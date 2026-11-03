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
  // 保留 Git 仓库供失败复核；批量删除需用户确认，不在验收中自动执行。
  console.log(`KEEP ${dir}`);
  runGit(['init'], repo);
  runGit(['config', 'user.name', 'Verify'], repo);
  runGit(['config', 'user.email', 'verify@example.com'], repo);
  fs.writeFileSync(path.join(repo, 'README.md'), '# base\n', 'utf8');
  runGit(['add', 'README.md'], repo);
  runGit(['commit', '-m', 'init'], repo);
  return body(repo);
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

/**
 * Given：计划是文件级的，只声明 files。
 * When：执行 commit_plan.mjs parse --ez-fast。
 * Then：返回 ok=true、plan_mode=file，步骤含 suppressed_split 字段。
 * 防回归：ez-fast 的计划必须能按文件级解析，-zp 场景靠它校验。
 */

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

/**
 * Given：计划是语义级的，步骤声明 changes。
 * When：执行 commit_plan.mjs parse --ez-fast。
 * Then：返回退出码 2 与错误码 invalid_plan。
 * 防回归：ez-fast 禁止语义计划，parse 子命令也要拒绝，否则 -zp 会放过无效计划。
 */

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

/**
 * Given：仓库 index 已预暂存一个文件，计划是语义级的。
 * When：执行 commit_plan.mjs commit --ez-fast。
 * Then：返回 invalid_plan 而非 staged_changes_present，HEAD 不变，预暂存内容原样保留。
 * 防回归：拒绝必须发生在任何 Git 写操作之前，index 不能被触碰或清空。
 */

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

/**
 * Given：仓库有计划内文件与计划外未跟踪文件。
 * When：执行 commit_plan.mjs commit --ez-fast 执行文件级计划。
 * Then：提交成功，计划内文件进入提交，计划外文件保持未跟踪。
 * 防回归：ez-fast 沿用文件级暂存约束，不得扩大到计划外路径。
 */

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

/**
 * Given：计划的两步各自声明 suppressed_split，其中一步内有重复项。
 * When：执行 commit_plan.mjs commit --ez-fast。
 * Then：结果含 semantic_split_disabled=true，suppressed_split 为跨步骤去重排序的并集。
 * 防回归：结果顶层字段回答本次是否禁用了语义拆分，并集不得漏项或重复。
 */

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

    /**
     * Given：文件级计划不含任何 suppressed_split 声明。
     * When：执行 commit_plan.mjs commit --ez-fast。
     * Then：结果含 semantic_split_disabled=true，suppressed_split 为空数组。
     * 防回归：无结构化文件时为空是正常态，字段不得省略或写成 null。
     */
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

/**
 * Given：同一份文件级计划不含 suppressed_split 声明。
 * When：执行 commit_plan.mjs commit，不带 --ez-fast。
 * Then：结果不含 semantic_split_disabled 与 suppressed_split 两个键。
 * 防回归：非 ez-fast 场景的结果契约必须字节级不变，字段不得泄漏。
 */

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

/**
 * Given：仓库有计划内文件。
 * When：同时传入 --ez-fast 与 --fast-path 执行提交。
 * Then：结果中 fast_path_used=true 且 semantic_split_disabled=true。
 * 防回归：两个 flag 必须正交，-zpc 场景下同时生效。
 */

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

/**
 * Given：计划某步的 suppressed_split 声明了不属于该步 files 的路径。
 * When：执行 commit_plan.mjs parse。
 * Then：返回错误码 invalid_plan，消息含该路径。
 * 防回归：suppressed_split 路径必须属于该步骤的 files，否则计划自相矛盾。
 */

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

/**
 * Given：计划是语义级的，步骤额外声明 suppressed_split。
 * When：执行 commit_plan.mjs parse。
 * Then：返回错误码 invalid_plan。
 * 防回归：该字段只对 files 有意义，语义模式声明它必须被拒绝。
 */

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

/**
 * Given：计划的 suppressed_split 写成块标量。
 * When：执行 commit_plan.mjs parse。
 * Then：返回错误码 invalid_plan。
 * 防回归：列表字段收到块标量时不能静默变成空列表，必须与 changes 同类拒绝。
 */

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

/**
 * Given：仓库有 6 个文件分布在两个顶层模块。
 * When：执行 inspect_fast_path.mjs --ez-fast。
 * Then：返回 eligible=true、ez_fast=true，semantic_split_reasons 照常报告。
 * 防回归：ez-fast 只放宽规划质量级条件，文件数上限与跨模块不再回退。
 */

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

/**
 * Given：仓库 index 已预暂存一个文件。
 * When：执行 inspect_fast_path.mjs --ez-fast。
 * Then：返回 eligible=false，fallback_reasons 含 staged_changes_present。
 * 防回归：Git 级条件一条不绕，ez-fast 不是绕过暂存保护的后门。
 */

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

/**
 * Given：--plan-file 指向一份无法解析的计划（步骤缺少 files）。
 * When：执行 inspect_fast_path.mjs --ez-fast。
 * Then：返回 eligible=false，fallback_reasons 含 invalid_plan。
 * 防回归：ez-fast 放宽的是拆分粒度，不是对无效计划的容忍。
 */
{
  withRepo((repo) => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    const planPath = path.join(repo, 'broken.yaml');
    fs.writeFileSync(planPath, '- step: 1\n  subject: "broken"\n', 'utf8');
    const result = run([INSPECT, '--cwd', repo, '--ez-fast', '--plan-file', planPath], ROOT);
    const payload = parseJson(result);
    check(
      '08#21 ez-fast 下计划无效仍回退',
      result.status === 0 && payload?.eligible === false
        && Array.isArray(payload?.fallback_reasons) && payload.fallback_reasons.includes('invalid_plan'),
      `eligible=${payload?.eligible} reasons=${JSON.stringify(payload?.fallback_reasons)}`,
    );
  });
}

/**
 * Given：计划在 files 里用正斜杠，在 suppressed_split 里用反斜杠写同一路径。
 * When：执行 commit_plan.mjs parse。
 * Then：解析成功，不报归属错误。
 * 防回归：归属校验此前用字符串全等比较，反斜杠写法会被误判为不属于该步骤。
 */
{
  const backslash = String.fromCharCode(92);
  const plan = [
    '- step: 1',
    '  subject: "feat(core): separator form"',
    '  files:',
    '    - src/a.txt',
    '  suppressed_split:',
    `    - src${backslash}a.txt`,
    '',
  ].join('\n');
  const result = run([COMMIT_PLAN, 'parse'], ROOT, plan);
  const payload = parseJson(result);
  check(
    '08#22 归属校验归一分隔符',
    result.status === 0 && payload?.ok === true,
    `status=${result.status} payload=${result.stdout}`,
  );
}

// --- 工单 09：文档同步面 ---

/**
 * Given：marketplace.json 已按工单更新。
 * When：读取并解析该文件。
 * Then：JSON 合法，git-up 条目的 version 为 3.0.0。
 * 防回归：插件入口版本必须与 skill 自身版本一致。
 */

// 15. marketplace.json 合法且 git-up 版本为 3.0.0。
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
    '09#15 marketplace.json 合法且 git-up 版本 3.0.0',
    parsed !== null && entry?.version === '3.0.0',
    `version=${entry?.version}`,
  );
}

/**
 * Given：SKILL.md 已按工单更新。
 * When：读取该文件。
 * Then：frontmatter version 为 3.0.0，正文含 ez-fast 章节。
 * 防回归：主定义文件的版本与内容必须同步。
 */

// 16. SKILL.md 版本 3.0.0 且含 ez-fast 章节。
{
  const skillPath = path.join(ROOT, 'skills', 'git-up', 'SKILL.md');
  const text = fs.readFileSync(skillPath, 'utf8');
  check(
    '09#16 SKILL.md 版本 3.0.0 且含 ez-fast 章节',
    /^version:\s*3\.0\.0$/m.test(text) && text.includes('ez-fast'),
    'frontmatter version 或 ez-fast 章节缺失',
  );
}

/**
 * Given：ez-fast 的详情独立成文。
 * When：检查 references/ez-fast.md。
 * Then：该文件存在。
 * 防回归：详情按渐进披露放在 references，主文件只留常用路径。
 */

// 17. references/ez-fast.md 存在。
{
  const referencePath = path.join(ROOT, 'skills', 'git-up', 'references', 'ez-fast.md');
  check('09#17 references/ez-fast.md 存在', fs.existsSync(referencePath), referencePath);
}

/**
 * Given：根 README、SKILL.md、skill README 与 ez-fast.md 含仓库内相对链接。
 * When：解析全部相对链接并逐个检查目标文件。
 * Then：不存在的链接清单为空。
 * 防回归：参数说明与详情链接不得断链，否则安装后无法查阅。
 */

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

/**
 * Given：根 README、SKILL.md 与 references/ez-fast.md 均已按新模式更新。
 * When：比对三处的兼容参数与拒绝规则。
 * Then：保留 -z 组合覆盖，d+z 与 i 混用被拒绝，grilling/modify 继承深度且兼容 --discuss。
 * 防回归：-d 已迁至 --deep，讨论主入口改为 -g/--grilling，不能丢失旧别名或把 --modify 当作 ez-fast 的拒绝组合。
 */

// 19. 根 README 与 references/ez-fast.md 的兼容组合和新 -d 规则一致。
{
  const rootReadme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const reference = fs.readFileSync(path.join(ROOT, 'skills', 'git-up', 'references', 'ez-fast.md'), 'utf8');
  const skillText = fs.readFileSync(path.join(ROOT, 'skills', 'git-up', 'SKILL.md'), 'utf8');
  const rootHasZ = /`?-{1,2}z`?/.test(rootReadme) && rootReadme.includes('--ez-fast');
  const referenceHasMatrix = ['-z', '-zp', '-zc', '-zpc', '-zs'].every((token) => reference.includes(token));
  const depthConflict = reference.split(/\r?\n/).some((line) =>
    line.includes('-z') && line.includes('-d/--deep') && line.includes('冲突'));
  const ignoreConflict = skillText.split(/\r?\n/).some((line) =>
    line.includes('-i') && line.includes('-z') && line.includes('不得'));
  const discussionInherits = reference.split(/\r?\n/).some((line) =>
    ['-g/--grilling', '--discuss', '--modify', '继承当前深度'].every((token) => line.includes(token)));
  check(
    '09#19 根 README 与参考文档参数口径一致',
    rootHasZ && referenceHasMatrix && depthConflict && ignoreConflict && discussionInherits,
    `rootHasZ=${rootHasZ} matrix=${referenceHasMatrix} depthConflict=${depthConflict} ignoreConflict=${ignoreConflict} discussionInherits=${discussionInherits}`,
  );
}

/**
 * Given：SKILL.md、references/ez-fast.md 与根 README 均已按工单更新。
 * When：比对三处的措辞。
 * Then：三处都含尽力而为或允许为空一类措辞。
 * 防回归：suppressed_split 是软字段，三处文档必须一致声明它不保证完整。
 */

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
