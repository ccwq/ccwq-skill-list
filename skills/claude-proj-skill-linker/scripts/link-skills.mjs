#!/usr/bin/env node
// claude-proj-skill-linker: 把项目 .agents/skills 接入项目 .claude/skills。
// 仅操作显式或当前工作目录给定的项目；拒绝全局配置树，容器必须为实体目录。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const MIN_NODE_MAJOR = 20;

function comparablePath(value) {
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const filesystemPath = value.startsWith('file:')
      ? fileURLToPath(value)
      : path.resolve(value);
    const candidates = new Set([path.normalize(filesystemPath)]);
    try {
      candidates.add(fs.realpathSync.native(filesystemPath));
    } catch {
      // The lexical path is still useful when the invocation path is absent.
    }
    for (const candidate of [...candidates]) {
      candidates.add(fileURLToPath(pathToFileURL(candidate)));
    }
    return [...candidates].map((candidate) => process.platform === 'win32' ? candidate.toLowerCase() : candidate);
  } catch {
    return [];
  }
}

export function isDirectExecution(argvPath, moduleUrl) {
  const argvCandidates = comparablePath(argvPath);
  const moduleCandidates = comparablePath(moduleUrl);
  return argvCandidates.some((candidate) => moduleCandidates.includes(candidate));
}

export const USAGE = `Usage:
  link-skills.mjs [--project-root <dir>] [--skill <name>...] [--apply --expect <digest>]

Default is read-only preview. --apply requires --expect matching the current
preview digest. Skills live in <root>/.agents/skills; entries in
<root>/.claude/skills.`;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function parseArgs(argv) {
  const args = {
    projectRoot: null,
    skills: [],
    apply: false,
    expect: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project-root') {
      args.projectRoot = requireValue(argv, ++i, arg);
    } else if (arg === '--skill') {
      args.skills.push(requireValue(argv, ++i, arg));
    } else if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--expect') {
      args.expect = requireValue(argv, ++i, arg);
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      fail('USAGE', `${USAGE}\nUnknown argument: ${arg}`);
    }
  }
  if (args.help) return args;
  if (args.apply && !args.expect) {
    fail('USAGE', `${USAGE}\n--apply requires --expect <digest> from a fresh preview.`);
  }
  if (!args.apply && args.expect) {
    fail('USAGE', `${USAGE}\n--expect is only valid together with --apply.`);
  }
  const seen = new Set();
  for (const name of args.skills) {
    validateSkillName(name);
    if (seen.has(name)) fail('USAGE', `Duplicate --skill value: ${name}`);
    seen.add(name);
  }
  return args;
}

function requireValue(argv, index, flag) {
  if (index >= argv.length) fail('USAGE', `${USAGE}\n${flag} requires a value.`);
  return argv[index];
}

const NAME_FORBIDDEN = /[\\/:*?"<>|]/;
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `com${n}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `lpt${n}`),
]);

export function validateSkillName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
    fail('BAD_NAME', `Invalid skill name: ${JSON.stringify(name)}`);
  }
  if (name !== name.trim() || name.endsWith('.')) {
    fail('BAD_NAME', `Invalid skill name (leading/trailing space or dot): ${JSON.stringify(name)}`);
  }
  if (name === '.' || name === '..') fail('BAD_NAME', `Invalid skill name: ${JSON.stringify(name)}`);
  if (NAME_FORBIDDEN.test(name)) fail('BAD_NAME', `Skill name contains forbidden characters: ${JSON.stringify(name)}`);
  if (name.includes('..')) fail('BAD_NAME', `Skill name contains '..': ${JSON.stringify(name)}`);
  if (/^[a-zA-Z]:/.test(name)) fail('BAD_NAME', `Skill name looks like a drive path: ${JSON.stringify(name)}`);
  if (name.includes('\0') || [...name].some((c) => c.charCodeAt(0) < 32)) {
    fail('BAD_NAME', `Skill name contains control characters: ${JSON.stringify(name)}`);
  }
  if (WINDOWS_RESERVED.has(name.toLowerCase())) {
    fail('BAD_NAME', `Skill name is a Windows reserved device name: ${JSON.stringify(name)}`);
  }
}

function samePath(a, b) {
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function pathStartsWith(base, candidate) {
  if (process.platform === 'win32') {
    return candidate.toLowerCase().startsWith(base.toLowerCase() + path.sep);
  }
  return candidate.startsWith(base + path.sep);
}

function isProtectedRoot(resolved) {
  // 返回拒绝原因；null 表示允许。
  if (path.parse(resolved).root === resolved) return 'filesystem root';
  const home = path.resolve(os.homedir());
  if (samePath(resolved, home)) return 'home directory';
  for (const globalName of ['.claude', '.agents']) {
    const globalTree = path.join(home, globalName);
    if (samePath(resolved, globalTree) || pathStartsWith(globalTree, resolved)) {
      return `global ${globalName} tree`;
    }
  }
  return null;
}

export function normalizeProjectRoot(inputRoot) {
  const resolved = path.resolve(inputRoot ?? process.cwd());
  const reason = isProtectedRoot(resolved);
  if (reason !== null) fail('BAD_ROOT', `Refusing to operate on ${reason}: ${resolved}`);
  return resolved;
}

async function lstatEntry(fullPath) {
  try {
    return await fsp.lstat(fullPath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function resolveLinkTarget(fullPath) {
  // 返回 { ok: true, target } 或 { ok: false }。断链、循环、错误一律 ok: false。
  try {
    const target = await fsp.realpath(fullPath);
    const targetStats = await fsp.stat(target);
    if (!targetStats.isDirectory()) return { ok: false };
    return { ok: true, target };
  } catch {
    return { ok: false };
  }
}

async function readSkillMd(skillPath) {
  // skillPath 必须已是实体目录或解析后的真实目录。
  const skillFile = path.join(skillPath, 'SKILL.md');
  try {
    const stats = await fsp.lstat(skillFile);
    if (!stats.isFile()) return false;
    const handle = await fsp.open(skillFile, 'r');
    try {
      const buffer = Buffer.alloc(1);
      await handle.read(buffer, 0, 1, 0);
      return true;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

function readSkillMdSync(skillPath) {
  const skillFile = path.join(skillPath, 'SKILL.md');
  try {
    const stats = fs.lstatSync(skillFile);
    if (!stats.isFile()) return false;
    const handle = fs.openSync(skillFile, 'r');
    try {
      const buffer = Buffer.alloc(1);
      fs.readSync(handle, buffer, 0, 1, 0);
      return true;
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return false;
  }
}
export async function classifySkillEntry(fullPath) {
  const stats = await lstatEntry(fullPath);
  if (stats === null) return { kind: 'absent' };
  if (stats.isSymbolicLink()) {
    const resolved = await resolveLinkTarget(fullPath);
    if (!resolved.ok) return { kind: 'broken-link' };
    return { kind: 'link', target: resolved.target };
  }
  if (stats.isDirectory()) {
    return (await readSkillMd(fullPath)) ? { kind: 'skill-dir' } : { kind: 'plain-dir' };
  }
  return { kind: 'file' };
}

async function listDirectChildren(dirPath) {
  try {
    return await fsp.readdir(dirPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertRealContainer(dirPath, label) {
  // 缺失允许；apply 阶段按需创建。存在则必须为实体目录：
  // 容器若是链接，其真实目标可能在项目外，写入会随之重定向。
  const stats = await lstatEntry(dirPath);
  if (stats === null) return;
  if (stats.isSymbolicLink()) {
    fail('BAD_CONTAINER', `${label} must be a real directory, not a link: ${dirPath}`);
  }
  if (!stats.isDirectory()) {
    fail('BAD_CONTAINER', `${label} must be a directory: ${dirPath}`);
  }
}

async function assertProtectedAncestors(root) {
  // 容器链上任何一环被替换为指向项目外的链接都会重定向写入；
  // 这里拒绝 .agents、.claude 及两个 skills 容器本身是链接的项目。
  for (const rel of ['.agents', '.claude', path.join('.agents', 'skills'), path.join('.claude', 'skills')]) {
    await assertRealContainer(path.join(root, rel), rel);
  }
}

async function realPathIfExists(fullPath) {
  try {
    return await fsp.realpath(fullPath);
  } catch {
    return null;
  }
}

export async function prepareContext(options) {
  const root = normalizeProjectRoot(options.projectRoot ?? process.cwd());
  // 使用真实根：项目根若是链接，写入仍应落在其真实位置，
  // 且保护判断（home/全局树）应基于真实位置而不是别名。
  const realRoot = (await realPathIfExists(root)) ?? root;
  const realReason = isProtectedRoot(realRoot);
  if (realReason !== null) fail('BAD_ROOT', `Refusing to operate on ${realReason} (resolved): ${realRoot}`);
  const agentsSkills = path.join(root, '.agents', 'skills');
  const claudeSkills = path.join(root, '.claude', 'skills');
  await assertProtectedAncestors(realRoot);
  return { root, agentsSkills, claudeSkills, selected: options.skills ?? [] };
}

function skillTargetPaths(ctx, name) {
  return {
    source: path.join(ctx.agentsSkills, name),
    entry: path.join(ctx.claudeSkills, name),
  };
}

export function entryIsCanonical(entryPath, ctx, name) {
  // 正确入口：链接目标（realpath 后）等于同名规范源路径（realpath 后）。
  const canonicalSource = path.join(ctx.agentsSkills, name);
  const stats = fs.lstatSync(entryPath);
  if (!stats.isSymbolicLink()) return false;
  const linkTarget = fs.readlinkSync(entryPath);
  const absoluteTarget = path.isAbsolute(linkTarget)
    ? linkTarget
    : path.resolve(path.dirname(entryPath), linkTarget);
  try {
    return samePath(fs.realpathSync(absoluteTarget), fs.realpathSync(canonicalSource));
  } catch {
    return false;
  }
}

function isSourceInsideProject(ctx, targetRealPath) {
  const base = process.platform === 'win32' ? ctx.agentsSkills.toLowerCase() : ctx.agentsSkills;
  const candidate = process.platform === 'win32' ? targetRealPath.toLowerCase() : targetRealPath;
  return candidate === base || candidate.startsWith(base + path.sep);
}

async function inspectPair(ctx, name) {
  const { source, entry } = skillTargetPaths(ctx, name);
  const sourceInfo = await classifySkillEntry(source);
  const entryInfo = await classifySkillEntry(entry);

  const item = { name, source, entry, sourceInfo, entryInfo, action: null, note: null };

  let sourceReadable = false;
  let sourceExternal = false;
  if (sourceInfo.kind === 'skill-dir') {
    sourceReadable = true;
  } else if (sourceInfo.kind === 'link') {
    sourceReadable = await readSkillMd(sourceInfo.target);
    sourceExternal = !isSourceInsideProject(ctx, sourceInfo.target);
  }

  if (sourceReadable) {
    item.action = 'link';
    if (sourceInfo.kind === 'link' && sourceExternal) {
      item.note = `source is a link to an external target: ${sourceInfo.target}`;
    }
  }

  if (entryInfo.kind === 'absent') {
    if (item.action === 'link') return item;
    if (sourceInfo.kind === 'skill-dir') {
      item.action = 'move-and-link';
      return item;
    }
    if (sourceInfo.kind === 'absent') {
      item.action = null;
      item.note = 'not found on either side; skipped';
      return item;
    }
    item.action = null;
    if (item.note === null) item.note = `source is ${sourceInfo.kind}; skipped`;
    return item;
  }

  if (entryInfo.kind === 'link') {
    if (entryIsCanonical(entry, ctx, name)) {
      item.action = null;
      item.note = 'already linked correctly; nothing to do';
      return item;
    }
    item.action = null;
    item.note = `entry is a non-canonical link to ${entryInfo.target}; preserved and reported`;
    return item;
  }

  if (entryInfo.kind === 'broken-link') {
    item.action = null;
    item.note = 'entry is a broken link; preserved and reported';
    return item;
  }

  if (entryInfo.kind === 'skill-dir') {
    if (sourceReadable || sourceInfo.kind === 'skill-dir') {
      item.action = null;
      item.note = 'same-name real skill directory exists on both sides; conflict, skipped';
      return item;
    }
    if (sourceInfo.kind === 'absent') {
      item.action = 'move-and-link';
      return item;
    }
    item.action = null;
    item.note = `entry is a real skill directory and source is ${sourceInfo.kind}; conflict, skipped`;
    return item;
  }

  if (entryInfo.kind === 'plain-dir') {
    item.action = null;
    item.note = 'entry is a directory without readable SKILL.md; skipped';
    return item;
  }

  item.action = null;
  item.note = 'entry is a plain file; skipped';
  return item;
}

async function scan(ctx) {
  let names;
  if (ctx.selected.length > 0) {
    // 按名选择：只检查选中的 skill，不枚举其余子项。
    names = new Set(ctx.selected);
  } else {
    const [sourceChildren, entryChildren] = await Promise.all([
      listDirectChildren(ctx.agentsSkills),
      listDirectChildren(ctx.claudeSkills),
    ]);
    names = new Set([...(sourceChildren ?? []), ...(entryChildren ?? [])]);
  }

  // 大小写/Unicode 碰撞保守跳过：NFC 后同名的对，只保留首个并报告。
  const canonicalMap = new Map();
  const collisions = new Map();
  for (const raw of names) {
    const canonical = raw.normalize('NFC');
    const key = process.platform === 'win32' || process.platform === 'darwin' ? canonical.toLowerCase() : canonical;
    if (canonicalMap.has(key)) {
      const first = canonicalMap.get(key);
      if (!collisions.has(first)) collisions.set(first, []);
      collisions.get(first).push(raw);
    } else {
      canonicalMap.set(key, raw);
    }
  }

  const items = [];
  for (const name of [...canonicalMap.values()].sort()) {
    const item = await inspectPair(ctx, name);
    if (collisions.has(name)) {
      item.action = null;
      item.note = `case/unicode collision with: ${collisions.get(name).join(', ')}; skipped`;
    }
    items.push(item);
  }
  return items;
}

function summarize(ctx, items) {
  // 摘要绑定真实项目根、选择范围与每个条目的完整判定结果。
  // 任何影响计划的因素变化（路径、分类、链接真实目标、行动、备注）都会改变摘要；
  // 内容本身不参与哈希——摘要代表"计划做什么"，不代表内容指纹。
  const payload = {
    version: 2,
    root: ctx.root,
    selected: ctx.selected.length > 0 ? [...ctx.selected].sort() : null,
    items: items.map((item) => ({
      name: item.name,
      source: item.source,
      entry: item.entry,
      sourceInfo: item.sourceInfo,
      entryInfo: item.entryInfo,
      action: item.action,
      note: item.note,
    })),
  };
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  return { digest, actionCount: items.filter((item) => item.action !== null).length };
}

function buildReport(ctx, items, summary, mode, results) {
  const output = {
    mode,
    root: ctx.root,
    agentsSkills: ctx.agentsSkills,
    claudeSkills: ctx.claudeSkills,
    digest: summary.digest,
    actionCount: summary.actionCount,
    items: items.map((item) => ({
      name: item.name,
      action: item.action,
      note: item.note,
      source: item.sourceInfo,
      entry: item.entryInfo,
    })),
  };
  if (mode === 'apply') output.results = results;
  return output;
}

async function createEntry(ctx, name) {
  const { source } = skillTargetPaths(ctx, name);
  await assertRealContainer(ctx.claudeSkills, '.claude/skills');
  await fsp.mkdir(ctx.claudeSkills, { recursive: true });
  const entryPath = path.join(ctx.claudeSkills, name);
  if (process.platform === 'win32') {
    // junction：免特权、可跨盘符；目标用绝对规范路径（保留源侧链接的间接性）。
    fs.symlinkSync(source, entryPath, 'junction');
  } else {
    const relativeTarget = path.relative(ctx.claudeSkills, source);
    await fsp.symlink(relativeTarget, entryPath, 'dir');
  }
  return entryPath;
}

function entryCreatedByThisStep(entryPath, expectedTarget) {
  // 仅当入口仍是本次创建的链接且指向本次规范源时才允许清理；
  // 其他进程创建或替换的实体/链接一律保留。
  try {
    const stats = fs.lstatSync(entryPath);
    if (!stats.isSymbolicLink()) return false;
    const linkTarget = fs.readlinkSync(entryPath);
    const absoluteTarget = path.isAbsolute(linkTarget)
      ? linkTarget
      : path.resolve(path.dirname(entryPath), linkTarget);
    return samePath(fs.realpathSync(absoluteTarget), fs.realpathSync(expectedTarget));
  } catch {
    return false;
  }
}

async function removeOwnEntry(entryPath, expectedTarget) {
  // 非递归移除：Windows junction 用 rmdir，POSIX symlink 用 unlink。
  try {
    await fsp.rmdir(entryPath);
    return null;
  } catch (error) {
    if (process.platform !== 'win32' && error.code === 'ENOTDIR') {
      try {
        await fsp.unlink(entryPath);
        return null;
      } catch (unlinkError) {
        return unlinkError;
      }
    }
    return error;
  }
}

function verifyEntry(ctx, name, entryPath) {
  const info = fs.lstatSync(entryPath);
  if (!info.isSymbolicLink()) fail('VERIFY', `Entry did not become a link: ${entryPath}`);
  if (!entryIsCanonical(entryPath, ctx, name)) {
    const { source } = skillTargetPaths(ctx, name);
    fail('VERIFY', `Entry does not point at canonical source ${source}: ${entryPath}`);
  }
  if (!readSkillMdSync(entryPath)) {
    fail('VERIFY', `SKILL.md is not readable through entry: ${path.join(entryPath, 'SKILL.md')}`);
  }
}

async function restoreMoved(source, originalEntryPath, createdEntryPath, expectedTarget) {
  // move 成功后建链/验收失败：先尝试移除本次创建的入口，再把源 rename 回原入口位置。
  let cleanupError = null;
  if (createdEntryPath !== null && entryCreatedByThisStep(createdEntryPath, expectedTarget)) {
    cleanupError = await removeOwnEntry(createdEntryPath, expectedTarget);
  }
  if (cleanupError !== null) {
    fail(
      'RESTORE_BLOCKED',
      `Cannot restore: failed to remove the entry created by this step (${cleanupError.code ?? cleanupError.message}). `
      + `Skill content remains at ${source}; stale entry at ${createdEntryPath}`,
    );
  }
  const occupant = await lstatEntry(originalEntryPath);
  if (occupant !== null) {
    fail('RESTORE_BLOCKED', `Cannot restore: original location is now occupied: ${originalEntryPath}. Skill content remains at ${source}`);
  }
  try {
    await fsp.rename(source, originalEntryPath);
  } catch (error) {
    fail('RESTORE_FAILED', `Restore failed (${error.code ?? error.message}); skill content remains at ${source}`);
  }
  const restored = await classifySkillEntry(originalEntryPath);
  if (restored.kind !== 'skill-dir') {
    fail('RESTORE_FAILED', `Restore could not be verified; skill content remains at ${source}`);
  }
}

async function applyItem(ctx, item) {
  const { source, entry } = skillTargetPaths(ctx, item.name);
  // 写入前重检容器：预览后容器可能被替换为链接。
  await assertProtectedAncestors(ctx.root);

  if (item.action === 'link') {
    const preCheck = await classifySkillEntry(source);
    if (preCheck.kind !== item.sourceInfo.kind) fail('DRIFT', `Source changed since preview: ${item.name}`);
    const entryCheck = await classifySkillEntry(entry);
    if (entryCheck.kind !== 'absent') fail('DRIFT', `Entry appeared since preview: ${item.name}`);
    const entryPath = await createEntry(ctx, item.name);
    try {
      verifyEntry(ctx, item.name, entryPath);
    } catch (error) {
      if (entryCreatedByThisStep(entryPath, source)) {
        const cleanupError = await removeOwnEntry(entryPath, source);
        if (cleanupError !== null) {
          fail('VERIFY', `${error.message} (cleanup failed: ${cleanupError.code ?? cleanupError.message}; stale entry at ${entryPath})`);
        }
      } else {
        // 入口被替换：保留现场，报告残留。
        fail('VERIFY', `${error.message} (entry at ${entryPath} was replaced; left in place)`);
      }
      throw error;
    }
    return { name: item.name, action: item.action, status: 'ok' };
  }

  if (item.action === 'move-and-link') {
    const preSource = await classifySkillEntry(source);
    if (preSource.kind !== 'absent') fail('DRIFT', `Source appeared since preview: ${item.name}`);
    const preEntry = await classifySkillEntry(entry);
    if (preEntry.kind !== 'skill-dir') fail('DRIFT', `Entry changed since preview: ${item.name}`);
    await assertRealContainer(ctx.agentsSkills, '.agents/skills');
    await fsp.mkdir(ctx.agentsSkills, { recursive: true });
    await fsp.rename(entry, source);
    let createdEntryPath = null;
    try {
      createdEntryPath = await createEntry(ctx, item.name);
      verifyEntry(ctx, item.name, createdEntryPath);
    } catch (error) {
      await restoreMoved(source, entry, createdEntryPath, source);
      throw error;
    }
    return { name: item.name, action: item.action, status: 'ok' };
  }

  fail('INTERNAL', `Unknown action: ${item.action}`);
}

export async function run(options) {
  if (Number.parseInt(process.versions.node, 10) < MIN_NODE_MAJOR) {
    fail('NODE_VERSION', `Node.js >= ${MIN_NODE_MAJOR} required, got ${process.versions.node}`);
  }
  const ctx = await prepareContext(options);
  const items = await scan(ctx);
  const summary = summarize(ctx, items);

  if (!options.apply) {
    return { report: buildReport(ctx, items, summary, 'preview'), exitCode: 0 };
  }

  if (options.expect !== summary.digest) {
    fail('STALE', `State changed since preview (current digest ${summary.digest}, expected ${options.expect}). Re-run preview and confirm again.`);
  }

  const results = [];
  const planned = items.filter((item) => item.action !== null);
  for (let i = 0; i < planned.length; i++) {
    const item = planned[i];
    try {
      results.push(await applyItem(ctx, item));
    } catch (error) {
      return {
        report: buildReport(ctx, items, summary, 'apply', results),
        exitCode: 1,
        error: { code: error.code ?? 'ERROR', message: error.message, name: item.name },
        stoppedBefore: planned.slice(i + 1).map((remaining) => remaining.name),
      };
    }
  }
  for (const result of results) {
    const item = planned.find((candidate) => candidate.name === result.name);
    try {
      verifyEntry(ctx, item.name, item.entry);
    } catch (error) {
      return {
        report: buildReport(ctx, items, summary, 'apply', results),
        exitCode: 1,
        error: { code: error.code ?? 'ERROR', message: error.message, name: item.name },
        stoppedBefore: [],
      };
    }
  }
  return { report: buildReport(ctx, items, summary, 'apply', results), exitCode: 0 };
}

async function main() {
  const argv = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(error.code === 'USAGE'
      ? `${error.message}\n`
      : `ERROR ${error.code ?? 'USAGE'}: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  try {
    const outcome = await run(parsed);
    if (outcome.error) {
      process.stderr.write(`ERROR ${outcome.error.code}: ${outcome.error.message} (skill: ${outcome.error.name})\n`);
      if (outcome.stoppedBefore?.length > 0) {
        process.stderr.write(`Stopped before: ${outcome.stoppedBefore.join(', ')}\n`);
      }
    } else {
      process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
    }
    process.exitCode = outcome.exitCode;
  } catch (error) {
    process.stderr.write(`ERROR ${error.code ?? 'ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (isDirectExecution(process.argv[1], import.meta.url)) {
  await main();
}
