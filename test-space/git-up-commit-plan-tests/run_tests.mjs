#!/usr/bin/env node
/**
 * git-up 脚本的轻量回归测试。
 *
 * 全部通过公开 CLI 行为验证，不依赖脚本内部实现。
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PROJECT_ROOT = path.resolve(ROOT, '..', '..');
const SCRIPT = path.join(PROJECT_ROOT, 'skills', 'git-up', 'scripts', 'commit_plan.mjs');
const IGNORE_SCRIPT = path.join(PROJECT_ROOT, 'skills', 'git-up', 'scripts', 'gitignore_manager.mjs');
const FAST_PATH_SCRIPT = path.join(PROJECT_ROOT, 'skills', 'git-up', 'scripts', 'inspect_fast_path.mjs');

class TestFailure extends Error {}

function runCommand(command, cwd, stdin = null) {
  return spawnSync(command[0], command.slice(1), {
    cwd,
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
}

/** 通过指定 shell 产出计划字节，再交给 commit_plan.mjs 解析。 */
function runShellPipe(shell, producerScript, yamlText) {
  const isPowerShell = path.basename(shell).toLowerCase() === 'powershell.exe';
  const producerArgs = isPowerShell
    ? ['-NoProfile', '-NonInteractive', '-Command', producerScript]
    : ['-lc', producerScript];
  const producer = spawn(shell, producerArgs, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, GIT_UP_PLAN: yamlText },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const consumer = spawn(process.execPath, [SCRIPT, 'parse'], {
    cwd: PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  producer.stdout.pipe(consumer.stdin);
  let consumerOut = '';
  let consumerErr = '';
  consumer.stdout.on('data', (chunk) => {
    consumerOut += chunk;
  });
  consumer.stderr.on('data', (chunk) => {
    consumerErr += chunk;
  });

  return new Promise((resolve) => {
    producer.on('close', (producerCode) => {
      consumer.on('close', (consumerCode) => {
        resolve({
          status: consumerCode !== 0 ? consumerCode : producerCode,
          stdout: consumerOut,
          stderr: consumerErr,
        });
      });
    });
  });
}

function powershellPath() {
  for (const candidate of ['powershell', 'powershell.exe']) {
    const found = findOnPath(candidate);
    if (found) return found;
  }
  throw new TestFailure('找不到 Windows PowerShell，无法验证 PowerShell 管道输入');
}

/**
 * 定位真正的 Git Bash。
 *
 * 不能直接用 PATH 上的 `bash`：Windows 的 `C:\Windows\System32\bash.exe` 是 WSL 启动器，
 * 它不保证透传环境变量，输出的是 WSL 提示文本而不是管道内容。
 */
function gitBashPath() {
  const candidates = [];

  // 由 git 可执行文件反推 Git 安装根目录，避免依赖固定的安装路径。
  const git = findOnPath('git');
  if (git) {
    const gitDir = path.dirname(git); // ...\Git\cmd 或 ...\Git\bin
    candidates.push(path.join(path.dirname(gitDir), 'bin', 'bash.exe'));
  }

  candidates.push(
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
  );

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    // Git Bash 必须能执行内建 printf。WSL 启动器在这里会被排除。
    const probe = spawnSync(candidate, ['-lc', 'printf "%s" ok'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (probe.status === 0 && probe.stdout === 'ok') return candidate;
  }

  throw new TestFailure('找不到可用的 Git Bash，无法验证 printf 管道输入');
}

function findOnPath(name) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, `${name}${ext}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // 继续找下一个候选。
      }
    }
  }
  return null;
}

function assertTrue(condition, message) {
  if (!condition) throw new TestFailure(message);
}

function parseJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new TestFailure(`输出不是合法 JSON: ${result.stdout}`);
  }
}

function runPlan(mode, yamlText, cwd = null, extraArgs = null) {
  const args = [SCRIPT, mode];
  if (extraArgs) args.push(...extraArgs);
  if (cwd !== null) args.push('--cwd', cwd);
  return runCommand([process.execPath, ...args], PROJECT_ROOT, yamlText);
}

/** 把计划写成 UTF-8 字节，再执行文件输入路径。 */
function runPlanFile(mode, yamlText) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-up-plan-'));
  const planPath = path.join(tmpDir, 'plan.yaml');
  try {
    fs.writeFileSync(planPath, yamlText, 'utf8');
    return runCommand([process.execPath, SCRIPT, mode, '--plan-file', planPath], PROJECT_ROOT);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function runIgnore(args, cwd) {
  return runCommand([process.execPath, IGNORE_SCRIPT, '--cwd', cwd, ...args], PROJECT_ROOT);
}

function runFastPath(cwd) {
  return runCommand([process.execPath, FAST_PATH_SCRIPT, '--cwd', cwd], PROJECT_ROOT);
}

function initRepo(repo) {
  runCommand(['git', 'init'], repo);
  runCommand(['git', 'config', 'user.name', 'Codex Test'], repo);
  runCommand(['git', 'config', 'user.email', 'codex-test@example.com'], repo);
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n', 'utf8');
  runCommand(['git', 'add', 'README.md'], repo);
  runCommand(['git', 'commit', '-m', 'init'], repo);
}

function withTempRepo(prefix, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return body(path.join(dir, 'repo'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testFastPathAcceptsSingleModuleChange() {
  /**
   * Given：仓库只有一个模块中的一个已跟踪文件发生修改，且暂存区为空。
   * When：运行快车道只读检查器。
   * Then：返回 eligible=true、单模块判断和空回退原因。
   * 防回归：确保简单 -pc/-pcP 场景不会被不必要地降级到完整 YAML 流程。
   */
  return withTempRepo('git-up-fast-simple-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'README.md'), '# changed\n', 'utf8');
    const result = runFastPath(repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(payload.eligible === true, '单模块小改动应进入快车道');
    assertTrue(payload.file_count === 1, '应报告一个改动文件');
    assertTrue(payload.fallback_reasons.length === 0, '命中快车道时不应有回退原因');
  });
}

function testFastPathRejectsPreStagedChange() {
  /**
   * Given：仓库 index 已存在用户预先暂存的文件。
   * When：运行快车道只读检查器。
   * Then：返回 eligible=false 和 staged_changes_present 原因。
   * 防回归：快车道不能绕过现有 staged 内容保护。
   */
  return withTempRepo('git-up-fast-staged-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged\n', 'utf8');
    runCommand(['git', 'add', 'staged.txt'], repo);
    const result = runFastPath(repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(payload.eligible === false, '已有 staged 内容时必须回退');
    assertTrue(payload.fallback_reasons.includes('staged_changes_present'), '应报告 staged 原因');
  });
}

function testFastPathRejectsCrossModuleChanges() {
  /**
   * Given：两个不同顶层模块各有一个文件发生修改。
   * When：运行快车道只读检查器。
   * Then：返回 eligible=false 和 multiple_modules 原因。
   * 防回归：避免把跨模块改动错误压缩为单一提交。
   */
  return withTempRepo('git-up-fast-modules-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'a.txt'), 'change\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'docs', 'b.txt'), 'change\n', 'utf8');
    runCommand(['git', 'add', 'src/a.txt', 'docs/b.txt'], repo);
    runCommand(['git', 'commit', '-m', 'seed modules'], repo);
    fs.writeFileSync(path.join(repo, 'src', 'a.txt'), 'change 2\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'docs', 'b.txt'), 'change 2\n', 'utf8');
    const result = runFastPath(repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(payload.eligible === false, '跨模块改动必须回退');
    assertTrue(payload.fallback_reasons.includes('multiple_modules'), '应报告跨模块原因');
  });
}

function testFastPathRejectsTooManyFiles() {
  /**
   * Given：单一模块内有六个已跟踪文件发生修改。
   * When：运行默认上限为五个文件的快车道只读检查器。
   * Then：返回 eligible=false 和 file_count_exceeded 原因。
   * 防回归：防止文件数量膨胀后仍错误跳过完整 YAML 规划。
   */
  return withTempRepo('git-up-fast-count-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    const paths = [];
    for (let index = 0; index < 6; index += 1) {
      const dir = path.join(repo, 'src');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `file-${index}.txt`), 'base\n', 'utf8');
      paths.push(`src/file-${index}.txt`);
    }
    runCommand(['git', 'add', ...paths], repo);
    runCommand(['git', 'commit', '-m', 'seed files'], repo);
    for (const relative of paths) {
      fs.writeFileSync(path.join(repo, relative), 'changed\n', 'utf8');
    }
    const result = runFastPath(repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(payload.eligible === false, '超过五个文件时必须回退');
    assertTrue(payload.fallback_reasons.includes('file_count_exceeded'), '应报告文件数超限');
  });
}

function testFastPathRejectsMergeConflict() {
  /**
   * Given：仓库处于未解决 merge conflict 状态。
   * When：运行快车道只读检查器。
   * Then：返回 eligible=false 和 conflicts_present 原因。
   * 防回归：快车道不得绕过冲突处理或把冲突文件纳入自动提交。
   */
  return withTempRepo('git-up-fast-conflict-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    const baseBranch = runCommand(['git', 'branch', '--show-current'], repo).stdout.trim();
    runCommand(['git', 'checkout', '-b', 'topic'], repo);
    fs.writeFileSync(path.join(repo, 'README.md'), '# topic\n', 'utf8');
    runCommand(['git', 'commit', '-am', 'topic change'], repo);
    runCommand(['git', 'checkout', baseBranch], repo);
    fs.writeFileSync(path.join(repo, 'README.md'), '# base\n', 'utf8');
    runCommand(['git', 'commit', '-am', 'base change'], repo);
    const merge = runCommand(['git', 'merge', 'topic'], repo);
    assertTrue(merge.status !== 0, '测试前置应形成 merge conflict');
    const result = runFastPath(repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(payload.eligible === false, '冲突状态必须回退');
    assertTrue(payload.fallback_reasons.includes('conflicts_present'), '应报告冲突原因');
  });
}

function testFastPathRejectsNestedGitBoundary() {
  /**
   * Given：仓库内嵌一个独立的 Git 仓库，其中的文件发生修改。
   * When：运行快车道只读检查器。
   * Then：返回 eligible=false 和 risky_paths_present 原因。
   * 防回归：快车道不得把嵌套仓库的改动纳入外层仓库的提交。
   */
  return withTempRepo('git-up-fast-nested-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    const nested = path.join(repo, 'vendor', 'lib');
    fs.mkdirSync(nested, { recursive: true });
    runCommand(['git', 'init'], nested);
    fs.writeFileSync(path.join(nested, 'dep.txt'), 'dep\n', 'utf8');
    runCommand(['git', 'add', 'dep.txt'], nested);
    runCommand(['git', 'commit', '-m', 'nested init'], nested);
    fs.writeFileSync(path.join(nested, 'dep.txt'), 'dep changed\n', 'utf8');
    const result = runFastPath(repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(payload.eligible === false, '嵌套 Git 边界必须回退');
    assertTrue(payload.fallback_reasons.includes('risky_paths_present'), '应报告风险路径原因');
    assertTrue(
      payload.risky_files.some((item) => item.includes('vendor')),
      '应指出嵌套仓库中的文件',
    );
  });
}

function testParseFullPlan() {
  /**
   * Given：git-up -p 输出包含 subject、body、foot、files 的固定 YAML 子集。
   * When：commit_plan.mjs parse 从 stdin 读取并解析计划。
   * Then：返回 ok=true，且多行 body 与 files 列表被正确保留。
   * 防回归：避免 YAML Lite parser 破坏常见提交正文和文件列表。
   */
  const yamlText = `- step: 1
  subject: "feat(skill): add parser"
  body: |
    - parse yaml-lite
    - execute git plan
  foot: "Refs: #1"
  files:
    - skills/git-up/SKILL.md
    - skills/git-up/scripts/commit_plan.mjs
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 0, result.stderr || result.stdout);
  assertTrue(payload.ok === true, '解析应成功');
  const step = payload.steps[0];
  assertTrue(step.body.includes('parse yaml-lite'), '多行 body 应保留');
  assertTrue(step.files.length === 2, 'files 应包含两个路径');
}

function testParseOptionalBodyAndFoot() {
  /**
   * Given：计划只包含 step、subject 和 files，省略 body 与 foot。
   * When：commit_plan.mjs parse 解析该最小有效计划。
   * Then：返回 ok=true，body 和 foot 使用空字符串默认值。
   * 防回归：保证可选字段缺失不会误判为语法错误。
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
  const step = payload.steps[0];
  assertTrue(step.body === '', 'body 缺失时应为空');
  assertTrue(step.foot === '', 'foot 缺失时应为空');
}

function testMissingFilesFails() {
  /**
   * Given：计划 step 缺少 files 安全边界字段。
   * When：commit_plan.mjs parse 校验该计划。
   * Then：返回 code=missing_files 且非 0，供 LLM 修复 YAML 后重试。
   * 防回归：禁止执行器在 files 缺失时猜测路径或 git add .。
   */
  const yamlText = `- step: 1
  subject: "fix(core): avoid unsafe add"
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 2, '缺 files 应返回解析错误码 2');
  assertTrue(payload.code === 'missing_files', '错误码应可被 LLM 识别');
}

function testParseLiteralBlockChompingVariants() {
  /**
   * Given：计划用 `|`、`|-`、`|+` 三种字面量块标量写多行 body。
   * When：commit_plan.mjs parse 解析这三份计划。
   * Then：三者解析出的 body 相同，尾部换行差异不被保留。
   * 防回归：解析器此前只认 `|` 一种写法，`|-` 与 `|+` 会退化成字面量字符串。
   */
  const variants = ['|', '|-', '|+'];
  const bodies = [];
  for (const variant of variants) {
    const yamlText = `- step: 1
  subject: "feat(core): block scalar"
  body: ${variant}
    第一行
    第二行
  files:
    - a.txt
`;
    const result = runPlan('parse', yamlText);
    const payload = parseJson(result);
    assertTrue(result.status === 0, `${variant} 应解析成功：${result.stderr || result.stdout}`);
    bodies.push(payload.steps[0].body);
  }
  assertTrue(bodies[0] === '第一行\n第二行', `body 应保留多行，实际 ${JSON.stringify(bodies[0])}`);
  assertTrue(bodies[1] === bodies[0], '|- 与 | 应解析出相同 body');
  assertTrue(bodies[2] === bodies[0], '|+ 与 | 应解析出相同 body');
}

function testParseRejectsFoldedBlockScalar() {
  /**
   * Given：计划用折叠块标量 `>` 写 body。
   * When：commit_plan.mjs parse 解析该计划。
   * Then：返回 code=invalid_plan，消息写明折叠块不支持，行号指向首行。
   * 防回归：折叠块此前被当成普通标量或报出无关的缩进错误。
   */
  const yamlText = `- step: 1
  subject: "feat(core): folded block"
  body: >
    第一行
  files:
    - a.txt
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 2, '折叠块应返回解析错误码 2');
  assertTrue(payload.code === 'invalid_plan', `错误码应为 invalid_plan，实际 ${payload.code}`);
  assertTrue(String(payload.message).includes('folded'), `消息应写明折叠块不支持，实际 ${payload.message}`);
  assertTrue(payload.line === 3, `行号应指向首行，实际 ${payload.line}`);
}

function testParseRejectsMalformedBlockHeader() {
  /**
   * Given：计划的 body 首行写成 `|x`，既不是合法首行也不是普通标量。
   * When：commit_plan.mjs parse 解析该计划。
   * Then：返回 code=invalid_plan，不把 `|x` 当成字面量字符串。
   * 防回归：畸形首行此前被静默当作普通标量，提交信息会带进 `|x`。
   */
  const yamlText = `- step: 1
  subject: "feat(core): malformed header"
  body: |x
    第一行
  files:
    - a.txt
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 2, '畸形首行应返回解析错误码 2');
  assertTrue(payload.code === 'invalid_plan', `错误码应为 invalid_plan，实际 ${payload.code}`);
  assertTrue(String(payload.message).includes('|x'), `消息应写明收到的首行，实际 ${payload.message}`);
}

function testParseRejectsBlockScalarOnListField() {
  /**
   * Given：计划把 files 写成块标量 `|`。
   * When：commit_plan.mjs parse 解析该计划。
   * Then：返回 code=invalid_plan，而不是静默变成空列表。
   * 防回归：列表字段收到块标量时此前被读成字符串，files 变空后报出无关的 missing_files。
   */
  const yamlText = `- step: 1
  subject: "feat(core): list field"
  files: |
    a.txt
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 2, '列表字段用块标量应返回解析错误码 2');
  assertTrue(payload.code === 'invalid_plan', `错误码应为 invalid_plan，实际 ${payload.code}`);
  assertTrue(String(payload.message).includes('files'), `消息应写明是 files 字段，实际 ${payload.message}`);
}

function testParseSubjectBlockWithoutContentFails() {
  /**
   * Given：计划的 subject 写成 `|-` 且后面没有内容块。
   * When：commit_plan.mjs parse 解析该计划。
   * Then：返回 code=missing_field，subject 为空，不产生字面量 `|-`。
   * 防回归：此前 `|-` 被当成普通标量，通过 subject 非空校验后产出一条标题为 `|-` 的提交。
   */
  const yamlText = `- step: 1
  subject: |-
  files:
    - a.txt
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 2, '空 subject 应返回解析错误码 2');
  assertTrue(payload.code === 'missing_field', `错误码应为 missing_field，实际 ${payload.code}`);
}

function testParseReportsMisindentedBlockContent() {
  /**
   * Given：计划的 body 块内容缩进三空格，不足四空格。
   * When：commit_plan.mjs parse 解析该计划。
   * Then：返回 code=indent，行号指向内容行。
   * 防回归：三空格内容行此前静默跳出块，随后在外层报 syntax 与「expected '<key>: <value>'」，归因错误。
   */
  const yamlText = `- step: 1
  subject: "feat(core): misindented block"
  body: |
   第一行
  files:
    - a.txt
`;
  const result = runPlan('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 2, '缩进不足应返回解析错误码 2');
  assertTrue(payload.code === 'indent', `错误码应为 indent，实际 ${payload.code}`);
  assertTrue(payload.line === 4, `行号应指向内容行，实际 ${payload.line}`);
}

function testCommitWritesMultiLineBodyFromChompedBlock() {
  /**
   * Given：计划用 `body: |-` 写多行正文并提交。
   * When：commit_plan.mjs commit 执行该计划。
   * Then：生成的提交信息包含全部正文行。
   * 防回归：`-` 写法此前无法解析，Agent 只能改写缩进并陷入错误循环。
   */
  return withTempRepo('git-up-block-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'planned.txt'), 'planned\n', 'utf8');
    const yamlText = `- step: 1
  subject: "feat(core): chomped block body"
  body: |-
    - 第一项改动
    - 第二项改动
  files:
    - planned.txt
`;
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stdout || result.stderr);
    assertTrue(payload.ok === true, '提交应成功');
    const message = runCommand(['git', 'log', '-1', '--format=%B'], repo).stdout;
    assertTrue(message.includes('第一项改动'), '提交信息应含第一行正文');
    assertTrue(message.includes('第二项改动'), '提交信息应含第二行正文');
    assertTrue(message.includes('feat(core): chomped block body'), '提交信息应含主题');
  });
}

function testParseRejectsMisindentedListEntry() {
  /**
   * Given：计划的 changes 条目缩进三空格，并且同一步骤还声明了 files。
   * When：commit_plan.mjs commit 执行该计划。
   * Then：返回 code=indent，不静默把 changes 读成空列表。
   * 防回归：缩进不足的条目行此前静默结束列表，changes 变空后计划降级成
   *         文件级模式，语义拆分意图被无声丢弃并直接提交。
   */
  return withTempRepo('git-up-list-entry-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'planned.txt'), 'planned\n', 'utf8');
    const stateFile = path.join(repo, '..', 'state.txt');
    fs.writeFileSync(stateFile, 'planned\n', 'utf8');
    const yamlText = `- step: 1
  subject: "feat(core): intended semantic split"
  changes:
   - path: planned.txt
      patch_mode: content
      patch_file: ${stateFile}
  files:
    - planned.txt
`;
    const before = runCommand(['git', 'rev-parse', 'HEAD'], repo).stdout.trim();
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    const after = runCommand(['git', 'rev-parse', 'HEAD'], repo).stdout.trim();
    assertTrue(result.status === 2, '缩进错误的条目行应返回解析错误码 2');
    assertTrue(payload.code === 'indent', `错误码应为 indent，实际 ${payload.code}`);
    assertTrue(before === after, '解析失败时不应创建提交');
  });
}

function testPlanFilePreservesUtf8PlanVariants() {
  /**
   * Given: a UTF-8 plan file contains Chinese text and emoji.
   * When: commit_plan.mjs parses with --plan-file.
   * Then: the original non-ASCII characters remain intact.
   * Regression: avoid Windows PowerShell native-pipeline replacement with '?'.
   */
  const yamlText = `- step: 1
  subject: "修复：解析计划 ✅"
  body: "保留中文和 emoji"
  files:
    - 中文.txt
`;
  const result = runPlanFile('parse', yamlText);
  const payload = parseJson(result);
  assertTrue(result.status === 0, result.stderr || result.stdout);
  assertTrue(payload.ok === true, 'UTF-8 plan file should parse');
  const step = payload.steps[0];
  assertTrue(step.subject === '修复：解析计划 ✅', 'subject must preserve UTF-8');
  assertTrue(step.body === '保留中文和 emoji', 'body must preserve UTF-8');
  assertTrue(
    step.files.length === 1 && step.files[0] === '中文.txt',
    'file paths must preserve UTF-8',
  );
}

async function testPowershellPipePreservesUtf8PlanVariants() {
  /**
   * Given：PowerShell 管道输出带 UTF-8 BOM 的 ASCII、中文和 emoji 计划。
   * When：commit_plan.mjs parse 从该管道读取计划。
   * Then：每种合法计划都能成功解析，非法计划仍返回内容校验错误。
   * 防回归：区分 PowerShell 编码边界问题与计划自身的结构错误。
   */
  const shell = powershellPath();
  const producerScript =
    '$bytes = [Text.Encoding]::UTF8.GetPreamble() + ' +
    '[Text.Encoding]::UTF8.GetBytes($env:GIT_UP_PLAN); ' +
    '[Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)';
  const validPlans = [
    '- step: 1\n  subject: "fix(parser): handle bom"\n  files:\n    - parser.mjs\n',
    '- step: 1\n  subject: "修复：解析计划"\n  body: "保留中文"\n  files:\n    - 中文.txt\n',
    '- step: 1\n  subject: "test: emoji ✅"\n  files:\n    - emoji.txt\n',
  ];
  for (const yamlText of validPlans) {
    const result = await runShellPipe(shell, producerScript, yamlText);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(payload.ok === true, 'PowerShell 管道中的合法计划应解析成功');
  }

  const invalid = '- step: 1\n  subject: "缺少 files"\n';
  const result = await runShellPipe(shell, producerScript, invalid);
  const payload = parseJson(result);
  assertTrue(result.status === 2, '非法计划应返回解析错误码 2');
  assertTrue(payload.code === 'missing_files', '非法计划应报告内容校验错误');
}

async function testGitBashPrintfPipePreservesPlanVariants() {
  /**
   * Given：Git Bash printf 管道输出 ASCII、中文和 emoji 计划。
   * When：commit_plan.mjs parse 从该管道读取计划。
   * Then：合法计划都能成功解析。
   * 防回归：确保 Git Bash 输入路径与 PowerShell 输入路径使用同一解析契约。
   */
  const shell = gitBashPath();
  const producerScript = 'printf "%s" "$GIT_UP_PLAN"';
  const validPlans = [
    '- step: 1\n  subject: "feat: add parser test"\n  files:\n    - test.mjs\n',
    '- step: 1\n  subject: "中文计划"\n  files:\n    - 中文.txt\n',
    '- step: 1\n  subject: "emoji ✅"\n  files:\n    - emoji.txt\n',
  ];
  for (const yamlText of validPlans) {
    const result = await runShellPipe(shell, producerScript, yamlText);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(payload.ok === true, 'Git Bash 管道中的合法计划应解析成功');
  }
}

function testCommitPlanExecutesOnlyPlannedFiles() {
  /**
   * Given：仓库里同时存在计划内文件和计划外未跟踪文件。
   * When：commit_plan.mjs commit 执行只列出计划内文件的提交计划。
   * Then：只提交计划内文件，计划外文件仍保持未跟踪状态。
   * 防回归：确保 fast path 延续 git-up 只 add 显式 files 的安全约束。
   */
  return withTempRepo('git-up-plan-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'planned.txt'), 'planned\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'unplanned.txt'), 'unplanned\n', 'utf8');
    const yamlText = `- step: 1
  subject: "test(plan): commit planned file"
  files:
    - planned.txt
`;
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    const status = runCommand(['git', 'status', '--short'], repo);
    const committed = runCommand(['git', 'show', '--name-only', '--format=', 'HEAD'], repo);
    assertTrue(result.status === 0, result.stdout);
    assertTrue(payload.ok === true, '提交应成功');
    assertTrue(payload.fast_path_used === false, '普通执行不得误报快车道');
    assertTrue(committed.stdout.includes('planned.txt'), '计划内文件应进入提交');
    assertTrue(status.stdout.includes('?? unplanned.txt'), '计划外文件应保持未跟踪');
  });
}

function testCommitRefusesPreStagedChanges() {
  /**
   * Given：执行前 index 已有暂存文件，存在提交计划外内容风险。
   * When：commit_plan.mjs commit 执行任意计划。
   * Then：返回 staged_changes_present，且不创建新提交。
   * 防回归：避免 fast path 把用户已有 staged 内容混入计划提交。
   */
  return withTempRepo('git-up-staged-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'planned.txt'), 'planned\n', 'utf8');
    runCommand(['git', 'add', 'staged.txt'], repo);
    const before = runCommand(['git', 'rev-parse', 'HEAD'], repo).stdout.trim();
    const yamlText = `- step: 1
  subject: "test(plan): commit planned file"
  files:
    - planned.txt
`;
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    const after = runCommand(['git', 'rev-parse', 'HEAD'], repo).stdout.trim();
    assertTrue(result.status === 1, '已有 staged 内容时应拒绝执行');
    assertTrue(payload.code === 'staged_changes_present', '错误码应说明 staged 冲突');
    assertTrue(before === after, '拒绝执行时不应产生新提交');
  });
}

function testCommitReportsFastPathUsage() {
  /**
   * Given：一个安全检查已确认的单 step 提交计划。
   * When：执行器收到 --fast-path 标记完成提交。
   * Then：结构化结果返回 fast_path_used=true。
   * 防回归：让性能路径是否实际命中可观测，避免只在 Skill 文档中宣称优化。
   */
  return withTempRepo('git-up-fast-exec-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'planned.txt'), 'planned\n', 'utf8');
    const yamlText = `- step: 1
  subject: "test(plan): fast path marker"
  files:
    - planned.txt
`;
    const result = runPlan('commit', yamlText, repo, ['--fast-path']);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stdout);
    assertTrue(payload.fast_path_used === true, '执行结果应标记快车道');
  });
}

function testFilePlanFollowsDependencyOrder() {
  /**
   * Given：文件级计划把后置步骤写在前面，并用 depends_on 声明前置步骤。
   * When：commit_plan.mjs commit 执行该计划。
   * Then：提交顺序遵循 depends_on，而不是计划里的书写顺序。
   * 防回归：depends_on 是计划模型的共享字段，文件级模式此前无视它。
   */
  return withTempRepo('git-up-plan-order-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n', 'utf8');
    runCommand(['git', 'add', 'a.txt', 'b.txt'], repo);
    runCommand(['git', 'commit', '-m', 'init'], repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'A\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'B\n', 'utf8');
    const yamlText = `- step: 2
  subject: "feat: second"
  depends_on:
    - 1
  files:
    - b.txt
- step: 1
  subject: "feat: first"
  files:
    - a.txt
`;
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stdout || result.stderr);
    const steps = payload.completed_steps;
    assertTrue(steps.join(',') === '1,2', `提交顺序应遵循依赖，实际 ${steps.join(',')}`);
    const log = runCommand(['git', 'log', '--oneline', '-2'], repo).stdout.split(/\r\n|\n|\r/).filter(Boolean);
    assertTrue(log[1].includes('feat: first'), '较早的提交应是前置步骤');
  });
}

function testFilePlanRejectsDependencyCycle() {
  /**
   * Given：文件级计划的两个步骤互相依赖。
   * When：commit_plan.mjs commit 执行该计划。
   * Then：返回 dependency_cycle，且不创建提交。
   * 防回归：依赖成环时不得按任意顺序提交。
   */
  return withTempRepo('git-up-plan-cycle-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8');
    runCommand(['git', 'add', 'a.txt'], repo);
    runCommand(['git', 'commit', '-m', 'init'], repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'A\n', 'utf8');
    const yamlText = `- step: 1
  subject: "feat: one"
  depends_on:
    - 2
  files:
    - a.txt
- step: 2
  subject: "feat: two"
  depends_on:
    - 1
  files:
    - a.txt
`;
    const before = runCommand(['git', 'rev-parse', 'HEAD'], repo).stdout.trim();
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    const after = runCommand(['git', 'rev-parse', 'HEAD'], repo).stdout.trim();
    assertTrue(result.status === 1, '依赖成环应返回失败');
    assertTrue(payload.code === 'dependency_cycle', `错误码应为 dependency_cycle，实际 ${payload.code}`);
    assertTrue(before === after, '依赖成环时不应创建提交');
  });
}

function testFilePlanReportsVerification() {
  /**
   * Given：文件级计划只提交计划内文件，仓库另有未跟踪文件。
   * When：commit_plan.mjs commit 执行该计划。
   * Then：结果包含 verification，状态为 verified，且最终树与目标树一致。
   * 防回归：执行结果契约要求两种模式都带最终一致性结论。
   */
  return withTempRepo('git-up-plan-verify-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    initRepo(repo);
    fs.writeFileSync(path.join(repo, 'planned.txt'), 'planned\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'untracked\n', 'utf8');
    const yamlText = `- step: 1
  subject: "test(plan): verification"
  files:
    - planned.txt
`;
    const result = runPlan('commit', yamlText, repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stdout || result.stderr);
    assertTrue(payload.verification, '结果应包含 verification');
    assertTrue(payload.verification.status === 'verified', '校验状态应为 verified');
    assertTrue(payload.verification.tree_match === true, '最终树应与目标树一致');
    assertTrue(payload.final_tree === payload.target_tree, '报告的树应一致');
    assertTrue(payload.base_head && payload.final_head, '结果应记录基线与最终 HEAD');
  });
}

function testIgnoreAutoDetectsNodeAndCreatesDocumentedRules() {
  /**
   * Given：一个尚未创建 .gitignore 的 Node.js 项目根目录。
   * When：gitignore_manager.mjs 不指定技术栈直接执行自动维护。
   * Then：创建带中文用途说明的 Node.js 与 OS 规则，且默认不加入 .env。
   * 防回归：防止自动模式漏掉依赖目录，或意外改变用户的环境文件跟踪策略。
   */
  return withTempRepo('git-up-ignore-node-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo"}\n', 'utf8');
    const result = runIgnore([], repo);
    const payload = parseJson(result);
    const content = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8');
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(payload.changed === true, '首次自动维护应创建规则');
    assertTrue(payload.created === true, '首次写入不存在的 .gitignore 应报告创建');
    assertTrue(
      payload.detected_stacks.length === 1 && payload.detected_stacks[0] === 'node',
      '应识别 package.json 对应的 Node.js 项目',
    );
    assertTrue(content.includes('# Git-up：Node.js 依赖与包管理日志'), '规则应有中文分组说明');
    assertTrue(content.includes('node_modules/'), '应忽略可重建的 Node.js 依赖');
    assertTrue(!content.includes('.env'), '默认不得自动添加 .env 规则');
  });
}

function testIgnoreSelectedStackDoesNotExpandOtherDetectedStack() {
  /**
   * Given：同时存在 Node.js 和 Python 清单的混合项目。
   * When：用户显式指定 python 技术栈执行维护。
   * Then：只写入 Python 规则，不自动扩展到 Node.js 规则。
   * 防回归：确保 `-i node python` 可作为精确控制入口而非提示性参数。
   */
  return withTempRepo('git-up-ignore-stack-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo"}\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8');
    const result = runIgnore(['python'], repo);
    const content = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8');
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(content.includes('.venv/'), '指定 python 时应写入 Python 虚拟环境规则');
    assertTrue(!content.includes('node_modules/'), '显式选择不得写入未选择的 Node.js 规则');
  });
}

function testIgnoreCustomRuleIsDocumentedAndIdempotent() {
  /**
   * Given：已有用户手写规则的项目，用户提供一条自定义忽略规则和原因。
   * When：以相同参数连续执行两次维护。
   * Then：保留原有内容，仅第一次添加带原因的规则，第二次跳过等价规则。
   * 防回归：避免自动维护覆盖手写 .gitignore 或反复追加重复条目。
   */
  return withTempRepo('git-up-ignore-custom-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, '.gitignore'), '# 用户规则\nmanual-cache/\n', 'utf8');
    const first = runIgnore(['--add', 'tmp/', '--reason', '本地调试输出'], repo);
    const second = runIgnore(['--add', 'tmp/', '--reason', '本地调试输出'], repo);
    const firstPayload = parseJson(first);
    const secondPayload = parseJson(second);
    const content = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8');
    assertTrue(first.status === 0 && second.status === 0, '自定义规则维护应成功');
    assertTrue(content.includes('# 用户规则') && content.includes('manual-cache/'), '用户原有规则必须保留');
    assertTrue(content.includes('# Git-up：本地调试输出'), '自定义规则必须使用用户提供的说明');
    assertTrue(
      content.split('tmp/').length - 1 === 1,
      '同一自定义规则不得重复追加',
    );
    assertTrue(firstPayload.changed === true, '首次添加应报告变更');
    assertTrue(
      secondPayload.changed === false && secondPayload.skipped_rules.includes('tmp/'),
      '再次执行应报告跳过',
    );
  });
}

function testIgnoreCleanPreviewsBeforeApply() {
  /**
   * Given：Git-up 管理区块中存在一条与用户已有规则重复的模式。
   * When：用户仅传入 --clean 而未传入 --apply。
   * Then：JSON 列出待删除规则，但 .gitignore 内容保持完全不变。
   * 防回归：清理模式必须先可见地说明影响，不能因为显式 clean 就直接删除内容。
   */
  return withTempRepo('git-up-ignore-clean-', (repo) => {
    fs.mkdirSync(repo, { recursive: true });
    const ignore = path.join(repo, '.gitignore');
    const original = '# 用户规则\nnode_modules/\n\n# Git-up：Node.js 依赖与包管理日志（可通过包管理器重新生成）\nnode_modules/\n';
    fs.writeFileSync(ignore, original, 'utf8');
    const result = runIgnore(['--clean'], repo);
    const payload = parseJson(result);
    assertTrue(result.status === 0, result.stderr || result.stdout);
    assertTrue(
      payload.mode === 'clean_preview' && payload.changed === false,
      '默认 clean 应只预览',
    );
    assertTrue(payload.removals[0].rule === 'node_modules/', '预览应说明重复规则');
    assertTrue(fs.readFileSync(ignore, 'utf8') === original, '预览阶段不得改写 .gitignore');
    const applied = runIgnore(['--clean', '--apply'], repo);
    const appliedPayload = parseJson(applied);
    assertTrue(
      applied.status === 0 && appliedPayload.changed === true,
      '明确 apply 后才应执行删除',
    );
    assertTrue(
      fs.readFileSync(ignore, 'utf8').split('node_modules/').length - 1 === 1,
      '应用清理后应只保留一个规则',
    );
  });
}

const TESTS = [
  testFastPathAcceptsSingleModuleChange,
  testFastPathRejectsPreStagedChange,
  testFastPathRejectsCrossModuleChanges,
  testFastPathRejectsTooManyFiles,
  testFastPathRejectsMergeConflict,
  testFastPathRejectsNestedGitBoundary,
  testParseFullPlan,
  testParseOptionalBodyAndFoot,
  testParseLiteralBlockChompingVariants,
  testParseRejectsFoldedBlockScalar,
  testParseRejectsMalformedBlockHeader,
  testParseRejectsBlockScalarOnListField,
  testParseSubjectBlockWithoutContentFails,
  testParseReportsMisindentedBlockContent,
  testParseRejectsMisindentedListEntry,
  testCommitWritesMultiLineBodyFromChompedBlock,
  testMissingFilesFails,
  testPlanFilePreservesUtf8PlanVariants,
  testPowershellPipePreservesUtf8PlanVariants,
  testGitBashPrintfPipePreservesPlanVariants,
  testCommitPlanExecutesOnlyPlannedFiles,
  testCommitRefusesPreStagedChanges,
  testCommitReportsFastPathUsage,
  testFilePlanFollowsDependencyOrder,
  testFilePlanRejectsDependencyCycle,
  testFilePlanReportsVerification,
  testIgnoreAutoDetectsNodeAndCreatesDocumentedRules,
  testIgnoreSelectedStackDoesNotExpandOtherDetectedStack,
  testIgnoreCustomRuleIsDocumentedAndIdempotent,
  testIgnoreCleanPreviewsBeforeApply,
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
