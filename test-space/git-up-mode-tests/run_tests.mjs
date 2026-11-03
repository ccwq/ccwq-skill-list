#!/usr/bin/env node
/**
 * git-up 3.0 模式契约回归。
 * Agent 路由仅检查公开文档；执行行为调用现有 CLI，不另建参数解析器。
 * 用户级路由没有机器解析器，文档断言不代表实际 LLM 路由已经得到验证。
 * 临时仓库与追踪文件保留供复核，不自动批量删除。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = path.join(ROOT, 'skills', 'git-up', 'scripts');
const COMMIT = path.join(SCRIPTS, 'commit_plan.mjs');
const INSPECT = path.join(SCRIPTS, 'inspect_fast_path.mjs');
const skill = fs.readFileSync(path.join(ROOT, 'skills', 'git-up', 'SKILL.md'), 'utf8');
const grilling = fs.readFileSync(path.join(ROOT, 'skills', 'git-up', 'references', 'grilling.md'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  .split('### git-up')[1]?.split('\n### ')[0] ?? '';

function command(executable, args, cwd, input = null, env = {}) {
  const result = spawnSync(executable, args, {
    cwd, input, encoding: 'utf8', windowsHide: true,
    timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  assert.ifError(result.error);
  return result;
}

function git(repo, ...args) {
  const result = command('git', args, repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function cli(script, args, repo, input = null, env = {}) {
  const result = command(process.execPath, [script, ...args, '--cwd', repo], ROOT, input, env);
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    assert.fail(`CLI 未输出 JSON：${result.stdout}\n${result.stderr}`);
  }
  return { ...result, payload };
}

// 同一份已知输入供轻量整体提交与 deep 中间状态提交对照。
const BASE = '{\n  "name": "demo"\n}\n';
const MIDDLE = '{\n  "name": "demo",\n  "dependencies": { "example": "1.0.0" }\n}\n';
const FINAL = '{\n  "name": "demo",\n  "dependencies": { "example": "1.0.0" },\n  "scripts": { "build": "node build.mjs" }\n}\n';
const FILE_PLAN = `- step: 1
  subject: "build: update dependencies and scripts"
  files:
    - package.json
  suppressed_split:
    - package.json
`;

function fixture() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'git-up-mode-'));
  console.log(`KEEP ${work}`);
  const repo = path.join(work, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init');
  git(repo, 'config', 'user.name', 'Git-up Mode Test');
  git(repo, 'config', 'user.email', 'mode-test@example.com');
  git(repo, 'config', 'core.autocrlf', 'false');
  // 临时仓库不继承用户的绝对 hooksPath 或提交签名设置。
  git(repo, 'config', 'core.hooksPath', path.join(repo, '.git', 'hooks'));
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'package.json'), BASE);
  git(repo, 'add', '--', 'package.json');
  git(repo, 'commit', '-m', 'seed');
  const baseHead = git(repo, 'rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(repo, 'package.json'), FINAL);
  const first = path.join(work, 'first.json');
  const final = path.join(work, 'final.json');
  fs.writeFileSync(first, MIDDLE);
  fs.writeFileSync(final, FINAL);
  const semanticPlan = `- step: 1
  subject: "build(deps): add dependency"
  changes:
    - path: package.json
      patch_mode: content
      patch_file: ${first}
- step: 2
  subject: "build(scripts): add build script"
  depends_on:
    - 1
  changes:
    - path: package.json
      patch_mode: content
      patch_file: ${final}
`;
  return { work, repo, baseHead, semanticPlan };
}

function succeeds(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.payload.ok, true, result.stdout);
  return result.payload;
}

function assertFinalTree(repo, payload) {
  // 不只比较执行器自己报告的两个值，还核对实际 Git 内容与已知目标。
  assert.equal(git(repo, 'ls-tree', '--name-only', 'HEAD'), 'package.json\n');
  assert.equal(git(repo, 'show', 'HEAD:package.json'), FINAL);
  assert.equal(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'), FINAL);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  const actualTree = git(repo, 'rev-parse', 'HEAD^{tree}').trim();
  assert.equal(payload.final_tree, actualTree);
  assert.equal(payload.target_tree, actualTree);
  assert.equal(payload.verification.tree_match, true);
  assert.equal(payload.verification.status, 'verified');
}

function digestTree(dir) {
  const entries = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else entries.push([
        path.relative(dir, full),
        createHash('sha256').update(fs.readFileSync(full)).digest('hex'),
      ]);
    }
  };
  visit(dir);
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

function hasRule(text, patterns, message) {
  const rules = text.split(/\r?\n/);
  assert.ok(rules.some((line) => patterns.every((pattern) => pattern.test(line))), message);
}

/**
 * Given：Agent 的公开模式文档与根参数速查已发布。
 * When：检查默认规划、显式 deep 和无参数调用的规则。
 * Then：默认文件级等价 -zp，-d/--deep 隐含 -p 且支持 -dp，无参数仅生成 message。
 * 防回归：深度切换属于 Agent 契约，不能误改原 CLI 默认或把 -d 当提交授权。
 */
function testDocumentDefaultAndDeepModes() {
  hasRule(skill, [/默认/, /文件级/, /-zp/], '默认新规划必须等价旧 -zp');
  hasRule(skill, [/-d`/, /--deep/, /深度/, /-dp/, /隐含.*-p/], '-d/--deep 应隐含 -p，与 -dp 同为深度规划');
  hasRule(skill, [/无参数/, /commit message/, /不规划/, /不提交/], '无参数必须保持 message-only');
  hasRule(readme, [/^\|/, /`-d`/, /--deep/, /深度/], '根参数表的 -d 必须映射 --deep');
  assert.doesNotMatch(readme, /\|\s*`-d`\s*\|\s*`--discuss`/, '根参数表不能保留旧 -d 讨论别名');
}

/**
 * Given：原讨论入口迁至 grilling，当前计划可能是轻量或 deep。
 * When：读取 -g、--grilling、兼容 --discuss 和 --modify 的公开规则。
 * Then：三个审查入口等价且继承深度，无计划先规划；modify 仍按直接反馈调整并输出 YAML。
 * 防回归：不得删除旧长参数、自动切 deep，或把反馈调整改为强制提问。
 */
function testDocumentGrillingAliasesAndModification() {
  hasRule(skill, [/-g`/, /--grilling/, /等价/, /--discuss/, /兼容别名/, /继承当前深度/, /不自动切 deep/, /无计划先按当前深度规划/], 'grilling 入口与旧别名应等价并保留深度');
  hasRule(skill, [/--modify/, /直接反馈/, /完整 YAML/, /不提交/, /继承当前深度/, /deep/, /显式授权/], 'modify 应独立保留直接调整和深度继承');
  hasRule(readme, [/^\|/, /`-g`/, /--grilling/, /--discuss/, /兼容/, /不提交/], '参数表应主推 -g/--grilling 并标明旧别名');
  assert.match(skill, /进入此分支必读.*references\/grilling\.md/, 'grilling 流程必须接入 Skill 路由');
}

/**
 * Given：提交计划需要审查分组、范围、依赖和风险，提问工具可能不可用。
 * When：读取 grilling reference 的逐轮审查流程。
 * Then：每轮 1–3 问，可用时使用 AskUserQuestion 给推荐选项，发问后等待回答并据此推进。
 * 防回归：不得自答或把推荐选项视作确认，也不得硬依赖特定外部 skill。
 */
function testDocumentGrillingInteraction() {
  hasRule(grilling, [/分组/, /范围/, /依赖/, /风险/], '应审查计划的四类关键决策');
  hasRule(grilling, [/每轮/, /1–3/, /AskUserQuestion/, /可用时/, /推荐选项/, /不可用时.*文字选项/], '提问工具应有推荐选项与文字回退');
  hasRule(grilling, [/等待用户回答/, /不自答/, /不把推荐项当作已确认/, /实际回答/], '发问后必须等待真实回答再推进');
  hasRule(grilling, [/本技能自足/, /不依赖外部 grilling skill/], 'grilling 流程应自足');
}

/**
 * Given：grilling 可继承轻量或 deep 深度，也可显式指定 -d -g 或 -z -g。
 * When：检查与其他主动作的互斥规则及审查阶段写入边界。
 * Then：深度和语言修饰可用，文件级不展开语义拆分，审查不改变业务文件、HEAD 或 index。
 * 防回归：-g、旧 --discuss 或 deep 修饰均不能自动授权提交、push 或委派执行。
 */
function testDocumentGrillingNonCommitBoundary() {
  hasRule(skill, [/-g`/, /不与/, /-p/, /-c/, /-s/, /-i/, /--modify/, /深度与语言修饰/, /-d -g/, /不隐含提交/, /冲突时解释并停止/], 'grilling 应互斥其他主动作，深度修饰不隐含提交');
  hasRule(skill, [/-z -g/, /文件级/, /范围与顺序/, /不展开语义拆分/, /deep.*拒绝降级/], 'z+g 应保持文件级且保护已有深度');
  hasRule(grilling, [/不修改业务文件、HEAD 或 index/, /不提交/, /不 push/, /不委派提交/, /另行.*提交动作/], '审查与达成共识均不构成提交授权');
  hasRule(skill, [/-P/, /--push/, /必须与提交动作组合/], 'grilling 不允许单独带 push');
}

/**
 * Given：会话中可能已有轻量、deep files 或缺少元数据的旧 changes 计划。
 * When：检查 -c、-dc 与 -zc 的计划继承规则。
 * Then：-c 保留深度，旧 changes 推 deep，-dc 重规划轻量计划，-zc 拒绝 deep。
 * 防回归：不能根据 files/changes 反推有元数据计划的深度或静默降级已有计划。
 */
function testDocumentExistingPlanDepth() {
  hasRule(skill, [/深度/, /独立于/, /files/, /changes/], '计划深度必须独立于 files/changes 格式');
  hasRule(skill, [/-c`.*继承.*深度/, /无元数据/, /changes/, /deep/, /不降级/], '-c 应继承，旧 changes 计划应推 deep');
  hasRule(skill, [/(?:-dc|-c -d)/, /轻量/, /重新.*深度规划/], '-dc 遇轻量计划应重新深度规划');
  hasRule(skill, [/(?:-zc|-c -z)/, /deep/, /拒绝/, /不降级/], '-zc 必须拒绝 deep 计划');
}

/**
 * Given：深度、委派、ignore 和主模式有各自授权边界。
 * When：检查冲突组合与委派修饰规则。
 * Then：d+z 拒绝，i 不与其他模式混用，s 可被 d 修饰但不混其他主模式。
 * 防回归：不能沿用旧 -s 禁止 -d 的规则，也不能放宽 ignore 或混合主模式。
 */
function testDocumentModeConflicts() {
  hasRule(skill, [/-z/, /-d/, /冲突/, /拒绝/], 'd+z 必须拒绝');
  hasRule(skill, [/-s/, /-d/, /修饰/, /不能.*其他主模式/], 's 应允许 d 修饰，但拒绝其他主模式');
  hasRule(skill, [/-i/, /不得.*深度/, /规划/, /提交/, /委派/, /讨论/, /--modify/, /-z/], 'i 应与其他模式互斥');
}

/**
 * Given：深度由 Agent 记录，执行器保留原公开 CLI。
 * When：读取 parse、commit、inspect 的参数透传契约。
 * Then：轻量操作均传 --ez-fast，deep 均不传，即使 deep 仅使用 files。
 * 防回归：不得按计划格式切换深度、添加未接入路由器或要求执行器接收 --deep。
 */
function testDocumentExecutorFlagPropagation() {
  hasRule(skill, [/Agent 层/, /深度/, /执行器没有.*--deep/], '路由应留在 Agent 层');
  hasRule(skill, [/轻量/, /parse/, /commit/, /inspect/, /均传.*--ez-fast/, /deep.*均不传/, /files/], '三个操作的 flags 必须遵循深度而不是计划格式');
}

/**
 * Given：同一结构化文件含依赖与 scripts 两类改动，使用默认轻量文件计划。
 * When：通过现有 parse、inspect、commit CLI 均显式传 --ez-fast。
 * Then：全部改动一次完整提交，实际 Git 树、工作区和校验结果一致。
 * 防回归：Agent 的默认文件级流程不能漏内容或在执行阶段偷偷进行语义拆分。
 */
function testDefaultFilePlanCompletesCommit() {
  const { work, repo, baseHead } = fixture();
  assert.equal(succeeds(cli(COMMIT, ['parse', '--ez-fast'], repo, FILE_PLAN)).plan_mode, 'file');
  const planPath = path.join(work, 'file-plan.yaml');
  fs.writeFileSync(planPath, FILE_PLAN);
  const inspected = cli(INSPECT, ['--ez-fast', '--plan-file', planPath], repo);
  assert.equal(inspected.status, 0, inspected.stdout);
  assert.equal(inspected.payload.ez_fast, true);
  assert.equal(inspected.payload.eligible, true, inspected.stdout);
  const payload = succeeds(cli(COMMIT, ['commit', '--ez-fast', '--plan-file', planPath], repo));
  assert.equal(payload.mode, 'file');
  assert.equal(payload.semantic_split_disabled, true);
  assert.deepEqual(payload.suppressed_split, ['package.json']);
  assert.equal(git(repo, 'rev-list', '--count', `${baseHead}..HEAD`).trim(), '1');
  assertFinalTree(repo, payload);
}

/**
 * Given：同样的改动使用显式 deep 的两步语义计划，中间状态只增加依赖。
 * When：通过现有 parse、inspect、commit CLI 不传 --ez-fast。
 * Then：产生两个真实提交，第一步不含 scripts，最终树与完整目标一致。
 * 防回归：deep 不得被默认轻量参数覆盖，语义拆分不能只在自建模型中成立。
 */
function testDeepSemanticPlanCompletesTwoCommits() {
  const { work, repo, baseHead, semanticPlan } = fixture();
  assert.equal(succeeds(cli(COMMIT, ['parse'], repo, semanticPlan)).plan_mode, 'semantic');
  const planPath = path.join(work, 'deep-plan.yaml');
  fs.writeFileSync(planPath, semanticPlan);
  const inspected = cli(INSPECT, ['--plan-file', planPath], repo);
  assert.equal(inspected.status, 0, inspected.stdout);
  assert.equal(inspected.payload.eligible, false);
  assert.ok(inspected.payload.fallback_reasons.includes('changes_present'), inspected.stdout);
  const payload = succeeds(cli(COMMIT, ['commit', '--plan-file', planPath], repo));
  assert.equal(payload.mode, 'semantic');
  assert.equal('semantic_split_disabled' in payload, false);
  assert.equal(payload.completed_steps.length, 2);
  assert.equal(git(repo, 'rev-list', '--count', `${baseHead}..HEAD`).trim(), '2');
  assert.equal(git(repo, 'show', 'HEAD~1:package.json'), MIDDLE);
  assertFinalTree(repo, payload);
}

/**
 * Given：语义计划误传默认 --ez-fast，仓库已有用户暂存内容。
 * When：执行现有 commit CLI 并开启 Git trace。
 * Then：先报 invalid_plan；Git 元数据、index 和工作区字节均不变，未调用 Git 写命令。
 * 防回归：必须在任何写入前拒绝，不得先落补丁或以 staged 冲突掩盖无效计划。
 */
function testSemanticEzFastRejectedBeforeWrites() {
  const { work, repo, semanticPlan } = fixture();
  fs.writeFileSync(path.join(repo, 'staged.txt'), 'user staged content\n');
  git(repo, 'add', '--', 'staged.txt');
  const before = digestTree(repo);
  const indexBefore = fs.statSync(path.join(repo, '.git', 'index')).mtimeMs;
  const tracePath = path.join(work, 'rejection-trace.json');
  const result = cli(COMMIT, ['commit', '--ez-fast'], repo, semanticPlan, { GIT_TRACE2_EVENT: tracePath });
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.payload.code, 'invalid_plan');
  assert.match(result.payload.message, /--ez-fast/);
  assert.deepEqual(digestTree(repo), before, '拒绝时不得改变 Git 元数据或工作区');
  assert.equal(fs.statSync(path.join(repo, '.git', 'index')).mtimeMs, indexBefore);
  const events = fs.existsSync(tracePath)
    ? fs.readFileSync(tracePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  const writes = /^(?:add|apply|commit|commit-tree|update-index|read-tree|write-tree|update-ref|reset|checkout|restore|clean|stash)$/;
  for (const event of events) {
    if (event.event !== 'start' || !Array.isArray(event.argv)) continue;
    const args = event.argv.slice(1);
    assert.ok(!args.some((arg) => writes.test(arg)) && !(args.includes('hash-object') && args.includes('-w')),
      `拒绝前不应调用 Git 写命令：${event.argv.join(' ')}`);
  }
}

/**
 * Given：合法文件计划与合法 deep 语义计划执行前，index 已有用户暂存内容。
 * When：分别执行带 --ez-fast 的轻量提交与不带该 flag 的 deep 提交。
 * Then：两者均报 staged_changes_present，HEAD、暂存字节和工作区保持原样。
 * 防回归：默认深度切换不能绕过执行器已有 index 保护。
 */
function testBothDepthsProtectExistingIndex() {
  const { repo, semanticPlan } = fixture();
  fs.writeFileSync(path.join(repo, 'staged.txt'), 'user staged content\n');
  git(repo, 'add', '--', 'staged.txt');
  const before = digestTree(repo);
  const inspected = cli(INSPECT, ['--ez-fast'], repo);
  assert.equal(inspected.payload.eligible, false);
  assert.ok(inspected.payload.fallback_reasons.includes('staged_changes_present'));
  for (const [plan, flags] of [[FILE_PLAN, ['--ez-fast']], [semanticPlan, []]]) {
    const result = cli(COMMIT, ['commit', ...flags], repo, plan);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.payload.code, 'staged_changes_present');
    assert.deepEqual(digestTree(repo), before, '拒绝合法计划时必须保留现有 index 与工作区');
  }
}

const tests = [
  testDocumentDefaultAndDeepModes,
  testDocumentGrillingAliasesAndModification,
  testDocumentGrillingInteraction,
  testDocumentGrillingNonCommitBoundary,
  testDocumentExistingPlanDepth,
  testDocumentModeConflicts,
  testDocumentExecutorFlagPropagation,
  testDefaultFilePlanCompletesCommit,
  testDeepSemanticPlanCompletesTwoCommits,
  testSemanticEzFastRejectedBeforeWrites,
  testBothDepthsProtectExistingIndex,
];
let failures = 0;
for (const test of tests) {
  try {
    test();
    console.log(`PASS ${test.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${test.name}: ${error.stack ?? error}`);
  }
}
console.log(`模式验收：${tests.length - failures} 项通过，${failures} 项失败；临时仓库已保留。`);
process.exitCode = failures ? 1 : 0;
