#!/usr/bin/env node
/**
 * git-up 语义拆分提交的核心层。
 *
 * 本模块提供语义模式（semantic mode）需要的四层能力：
 *
 * 1. 计划模型：解析 YAML Lite 计划的语义扩展字段（reason / depends_on / changes）。
 * 2. 精确暂存：用 `git apply --cached` 或 index 直写，把独立补丁写入 index。
 * 3. 目标快照：记录执行前工作区的目标状态，作为最终校验的基准。
 * 4. 最终校验：比较最终 HEAD 与目标快照，证明拆分提交既没有丢失改动，也没有扩大提交范围。
 *
 * 安全约束：
 *
 * - 只使用原生 Git 的非交互式命令，执行过程不需要终端输入。
 * - 不执行 `git add .`、`git commit -a`、`git reset --hard` 或 checkout 清理。
 * - 暂存只写 index，工作区文件在整个流程中保持不变。
 * - 暂存区已有内容时立即停止，避免把计划外改动混入提交。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// 错误码
// ---------------------------------------------------------------------------
export const CODE_STAGED_CHANGES = 'staged_changes_present';
export const CODE_INVALID_PLAN = 'invalid_plan';
export const CODE_PATCH_APPLY = 'patch_apply_failure';
export const CODE_SCOPE_MISMATCH = 'patch_scope_mismatch';
export const CODE_DEPENDENCY_CYCLE = 'dependency_cycle';
export const CODE_UNSUPPORTED_OP = 'unsupported_operation';
export const CODE_COMMIT_FAILURE = 'commit_failure';
export const CODE_VERIFICATION = 'target_verification_failure';
export const CODE_GIT_FAILED = 'git_failed';

// 语义模式判定为「需要拆分」的原因
export const REASON_CHANGES = 'changes_present';
export const REASON_SHARED_PATH = 'shared_path_across_steps';
export const REASON_PATCH_FILES = 'patch_files_present';
export const REASON_INTERMEDIATE = 'intermediate_states_present';
export const REASON_DEPENDENCIES = 'dependencies_present';
export const REASON_UNSUPPORTED = 'unsupported_operations_present';

export const PATCH_MODES = ['patch', '3way', 'content'];
const PATCH_MODES_NEEDING_FILE = ['patch', '3way'];

const MAX_GIT_OUTPUT = 256 * 1024 * 1024;

export class PlanError extends Error {
  constructor(code, message, line = null, details = {}) {
    super(message);
    this.name = 'PlanError';
    this.code = code;
    this.line = line;
    this.details = details;
  }

  toDict() {
    const payload = { ok: false, code: this.code, message: this.message };
    if (this.line !== null && this.line !== undefined) {
      payload.line = this.line;
    }
    return { ...payload, ...this.details };
  }
}

// ---------------------------------------------------------------------------
// 计划模型
// ---------------------------------------------------------------------------

/**
 * 创建一个语义变更条目。
 *
 * patchMode 决定补丁的落地方式：
 *
 * - `patch`：统一 diff，用 `git apply --cached` 写入 index。
 * - `3way`：统一 diff，用 `git apply --cached --3way` 写入 index。
 * - `content`：中间状态文件，用其完整内容替换 index 中的路径。
 */
export function createChange({ path: changePath, patchMode = 'patch', patchFile = '', whitespace = 'nowarn' }) {
  return { path: changePath, patchMode, patchFile, whitespace };
}

/**
 * 创建一个提交步骤。files 是兼容的文件级模式，changes 是语义模式。
 */
export function createStep({
  step,
  subject,
  body = '',
  foot = '',
  files = [],
  reason = '',
  dependsOn = [],
  changes = [],
}) {
  return { step, subject, body, foot, files, reason, dependsOn, changes };
}

/** 生成提交信息正文。 */
export function stepMessage(step) {
  const parts = [step.subject];
  if (step.body) parts.push('', step.body);
  if (step.foot) parts.push('', step.foot);
  return `${parts.join('\n').replace(/\s+$/, '')}\n`;
}

/** 本步骤允许触碰的路径集合（去重后排序）。 */
export function stepScopePaths(step) {
  const paths = [...step.changes.map((change) => change.path), ...step.files];
  return [...new Set(paths)].sort();
}

/** 把步骤转换成可 JSON 序列化的对象。 */
export function stepToDict(step) {
  return {
    step: step.step,
    subject: step.subject,
    body: step.body,
    foot: step.foot,
    files: step.files,
    reason: step.reason,
    depends_on: step.dependsOn,
    changes: step.changes.map((change) => ({
      path: change.path,
      patch_mode: change.patchMode,
      patch_file: change.patchFile,
      whitespace: change.whitespace,
    })),
  };
}

// ---------------------------------------------------------------------------
// YAML Lite 解析
// ---------------------------------------------------------------------------
function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    (trimmed[0] === '"' || trimmed[0] === "'") &&
    trimmed[0] === trimmed[trimmed.length - 1]
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === "''" || trimmed === '""') return '';
  return stripQuotes(trimmed);
}

function splitKeyValue(text, lineNo) {
  const index = text.indexOf(':');
  if (index === -1) {
    throw new PlanError('syntax', "expected '<key>: <value>'", lineNo);
  }
  const key = text.slice(0, index).trim();
  if (!key) {
    throw new PlanError('syntax', 'empty key is not supported', lineNo);
  }
  return [key, text.slice(index + 1).trim()];
}

/**
 * 解析块标量首行标记。
 *
 * 只认未加引号的值。加引号是写普通字符串的方式，`body: "|"` 是字面量竖线。
 * 支持 `|`、`|-`、`|+` 三种字面量写法。折叠写法 `>` 与显式缩进指示符（`|2`）不实现。
 *
 * @param {string} rawValue 冒号后的原始值
 * @param {number} lineNo 首行所在行号
 * @returns {null | {style: 'literal'}} null 表示该值不是块标量首行
 */
function parseBlockHeader(rawValue, lineNo) {
  const value = rawValue.trim();
  if (value === '') return null;
  if (value[0] === '"' || value[0] === "'") return null;
  if (value[0] !== '|' && value[0] !== '>') return null;
  if (!/^[|>][-+]?$/.test(value)) {
    throw new PlanError(
      CODE_INVALID_PLAN,
      `unsupported block scalar header "${value}"; supported headers are |, |- and |+`,
      lineNo,
    );
  }
  if (value[0] === '>') {
    throw new PlanError(
      CODE_INVALID_PLAN,
      `folded block scalar "${value}" is not supported; use |, |- or |+`,
      lineNo,
    );
  }
  return { style: 'literal' };
}

/**
 * 两空格缩进且形似字段的行。用于区分「下一个字段」与「缩进不足的块内容」。
 */
const STEP_FIELD_PATTERN = /^ {2}[^\s:]+:/;

/**
 * 读取 `key: |` 之后的四空格缩进块。
 *
 * 块内容必须缩进四空格。缩进不足的内容行抛 `indent` 并指向该行，
 * 避免它被当成下一个字段后报出无关的语法错误。
 */
function readBlockScalar(lines, index) {
  const block = [];
  let i = index;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim()) {
      block.push('');
      i += 1;
      continue;
    }
    if (raw.startsWith('    ')) {
      block.push(raw.slice(4));
      i += 1;
      continue;
    }
    // 无缩进的 `- ` 开头是下一个步骤，结束块。
    if (raw.startsWith('- ')) break;
    // 恰好两空格缩进：形似字段则结束块，否则是缩进不足的块内容。
    if (raw.startsWith('  ') && !raw.startsWith('   ')) {
      if (STEP_FIELD_PATTERN.test(raw)) break;
    }
    throw new PlanError('indent', 'block scalar lines must use four-space indentation', i + 1);
  }
  return [block.join('\n').replace(/\s+$/, ''), i];
}

/** 读取四空格缩进的 `- item` 列表。 */
function readScalarList(lines, index, key) {
  const items = [];
  let i = index;
  while (i < lines.length) {
    const raw = lines[i];
    const itemLineNo = i + 1;
    if (!raw.trim()) {
      i += 1;
      continue;
    }
    if (raw.startsWith('    - ')) {
      const item = parseScalar(raw.slice(6));
      if (!item) {
        const code = key === 'files' ? 'invalid_files' : CODE_INVALID_PLAN;
        throw new PlanError(code, `${key} entries must not be empty`, itemLineNo);
      }
      items.push(item);
      i += 1;
      continue;
    }
    if (raw.startsWith('  ') || raw.startsWith('- ')) break;
    throw new PlanError('indent', `${key} entries must use four-space list indentation`, itemLineNo);
  }
  return [items, i];
}

/** 读取 changes 列表。每个条目是四空格缩进的映射，续行字段使用六空格缩进。 */
function readChangeList(lines, index) {
  const entries = [];
  let i = index;
  while (i < lines.length) {
    const raw = lines[i];
    const itemLineNo = i + 1;
    if (!raw.trim()) {
      i += 1;
      continue;
    }
    if (raw.startsWith('    - ')) {
      const entry = {};
      const [key, value] = splitKeyValue(raw.slice(6).trim(), itemLineNo);
      entry[key] = parseScalar(value);
      i += 1;
      while (i < lines.length) {
        const cont = lines[i];
        const contLineNo = i + 1;
        if (!cont.trim()) {
          i += 1;
          continue;
        }
        if (cont.startsWith('      ')) {
          const [contKey, contValue] = splitKeyValue(cont.slice(6), contLineNo);
          entry[contKey] = parseScalar(contValue);
          i += 1;
          continue;
        }
        break;
      }
      entries.push(entry);
      continue;
    }
    if (raw.startsWith('  ') || raw.startsWith('- ')) break;
    throw new PlanError('indent', 'changes entries must use four-space list indentation', itemLineNo);
  }
  return [entries, i];
}

/** 解析 `depends_on: [1, 2]` 形式的内联列表。 */
function parseInlineIntList(value, lineNo) {
  const inner = value.trim().slice(1, -1).trim();
  if (!inner) return [];
  const items = [];
  for (const part of inner.split(',')) {
    const text = part.trim();
    if (!text) {
      throw new PlanError(CODE_INVALID_PLAN, 'depends_on entries must not be empty', lineNo);
    }
    if (!/^-?\d+$/.test(text)) {
      throw new PlanError(CODE_INVALID_PLAN, `depends_on entry is not an integer: ${text}`, lineNo);
    }
    items.push(Number.parseInt(text, 10));
  }
  return items;
}

/** 读取一个字段的值，返回 [值, 下一个行索引]。 */
function readValue(lines, index, key, rawValue, lineNo) {
  const value = rawValue.trim();
  // 块标量首行判定必须早于列表字段的分支。
  // 列表字段收到块标量时不能静默变成空列表或错值。
  const header = parseBlockHeader(rawValue, lineNo);
  if (header) {
    if (key === 'files' || key === 'depends_on' || key === 'changes') {
      throw new PlanError(CODE_INVALID_PLAN, `${key} must not use a block scalar`, lineNo);
    }
    return readBlockScalar(lines, index);
  }
  if (key === 'files') {
    if (value === '') return readScalarList(lines, index, 'files');
    return [parseScalar(value), index];
  }
  if (key === 'depends_on') {
    if (value.startsWith('[') && value.endsWith(']')) {
      return [parseInlineIntList(value, lineNo), index];
    }
    if (value === '') {
      const [rawItems, nextIndex] = readScalarList(lines, index, 'depends_on');
      const items = [];
      for (const item of rawItems) {
        if (!/^-?\d+$/.test(item.trim())) {
          throw new PlanError(CODE_INVALID_PLAN, `depends_on entry is not an integer: ${item}`, lineNo);
        }
        items.push(Number.parseInt(item.trim(), 10));
      }
      return [items, nextIndex];
    }
    return [parseScalar(value), index];
  }
  if (key === 'changes') {
    if (value) {
      throw new PlanError(CODE_INVALID_PLAN, 'changes must be a list', lineNo);
    }
    return readChangeList(lines, index);
  }
  return [parseScalar(value), index];
}

/**
 * 解析 YAML Lite 提交计划。
 *
 * 支持的步骤字段：step、subject、body、foot、reason、depends_on、files、changes。
 */
export function parsePlan(text) {
  // Windows PowerShell 可能在管道文本开头携带 UTF-8 BOM；它不是计划内容。
  const normalized = text.startsWith('﻿') ? text.slice(1) : text;
  const lines = normalized.split(/\r\n|\n|\r/);
  const rawSteps = [];
  let current = null;
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const lineNo = i + 1;
    if (!raw.trim()) {
      i += 1;
      continue;
    }

    if (raw.startsWith('- ')) {
      current = {};
      rawSteps.push(current);
      const rest = raw.slice(2).trim();
      i += 1;
      if (rest) {
        const [key, value] = splitKeyValue(rest, lineNo);
        const [parsed, nextIndex] = readValue(lines, i, key, value, lineNo);
        current[key] = parsed;
        i = nextIndex;
      }
      continue;
    }

    if (current === null) {
      throw new PlanError('syntax', 'plan must be a top-level list', lineNo);
    }

    if (!raw.startsWith('  ') || raw.startsWith('    ')) {
      throw new PlanError('indent', 'step fields must use two-space indentation', lineNo);
    }

    const [key, value] = splitKeyValue(raw.slice(2), lineNo);
    i += 1;
    const [parsed, nextIndex] = readValue(lines, i, key, value, lineNo);
    current[key] = parsed;
    i = nextIndex;
  }

  if (rawSteps.length === 0) {
    throw new PlanError('empty_plan', 'plan contains no steps');
  }

  const steps = buildSteps(rawSteps);
  validatePlanStructure(steps);
  return steps;
}

/** 把原始步骤字典转换为步骤对象，并做字段级校验。 */
function buildSteps(rawSteps) {
  return rawSteps.map((item, index) => {
    const position = index + 1;
    if (!('step' in item)) {
      throw new PlanError('missing_field', `step ${position} is missing required field: step`);
    }
    if (!('subject' in item)) {
      throw new PlanError('missing_field', `step ${position} is missing required field: subject`);
    }

    const stepRaw = item.step;
    const stepText = String(stepRaw).trim();
    if (!/^-?\d+$/.test(stepText)) {
      throw new PlanError('invalid_step', `step ${position} has non-integer step value: ${stepRaw}`);
    }
    const stepNo = Number.parseInt(stepText, 10);

    const subject = String(item.subject).trim();
    if (!subject) {
      throw new PlanError('missing_field', `step ${stepNo} subject must not be empty`);
    }

    const files = Array.isArray(item.files) ? item.files.map((file) => String(file)) : [];

    // depends_on 必须是列表。标量写法会被静默丢弃，导致依赖顺序失效。
    let dependsOn = [];
    if (item.depends_on !== undefined && item.depends_on !== null && item.depends_on !== '') {
      if (!Array.isArray(item.depends_on)) {
        throw new PlanError(
          CODE_INVALID_PLAN,
          `step ${stepNo} depends_on must be a list of step numbers, for example "depends_on: [1]"`,
        );
      }
      dependsOn = item.depends_on.map((value) => Number(value));
      for (const dependency of dependsOn) {
        if (!Number.isInteger(dependency)) {
          throw new PlanError(
            CODE_INVALID_PLAN,
            `step ${stepNo} depends_on entry is not an integer: ${dependency}`,
          );
        }
      }
    }

    const changes = [];
    if (Array.isArray(item.changes)) {
      for (const entry of item.changes) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new PlanError(CODE_INVALID_PLAN, `step ${stepNo} change entry must be a mapping`);
        }
        changes.push(
          createChange({
            path: String(entry.path ?? ''),
            patchMode: String(entry.patch_mode ?? 'patch') || 'patch',
            patchFile: String(entry.patch_file ?? ''),
            whitespace: String(entry.whitespace ?? 'nowarn') || 'nowarn',
          }),
        );
      }
    }

    return createStep({
      step: stepNo,
      subject,
      body: String(item.body ?? '').trim(),
      foot: String(item.foot ?? '').trim(),
      files,
      reason: String(item.reason ?? '').trim(),
      dependsOn,
      changes,
    });
  });
}

/** 校验计划结构。文件级模式要求 files，语义模式要求 changes。 */
export function validatePlanStructure(steps) {
  if (planMode(steps) === 'semantic') {
    for (const step of steps) {
      if (step.changes.length === 0) {
        throw new PlanError(
          CODE_INVALID_PLAN,
          `step ${step.step} must declare changes in semantic mode; file-level staging is not allowed`,
        );
      }
      if (step.files.length > 0) {
        throw new PlanError(
          CODE_INVALID_PLAN,
          `step ${step.step} must not declare files in semantic mode; describe every change with changes`,
        );
      }
    }
    return;
  }

  for (const step of steps) {
    if (step.files.length === 0) {
      throw new PlanError('missing_files', `step ${step.step} files is required and must not be empty`);
    }
  }
}

/** 返回 semantic 或 file。任一步骤声明 changes 即进入语义模式。 */
export function planMode(steps) {
  return steps.some((step) => step.changes.length > 0) ? 'semantic' : 'file';
}

/** 列出需要语义拆分的判定原因。空列表表示可以走快车道。 */
export function semanticSplitReasons(steps, cwd = null) {
  const reasons = [];
  if (steps.some((step) => step.changes.length > 0)) reasons.push(REASON_CHANGES);
  if (steps.some((step) => step.dependsOn.length > 0)) reasons.push(REASON_DEPENDENCIES);

  const counter = new Map();
  for (const step of steps) {
    for (const scopePath of stepScopePaths(step)) {
      counter.set(scopePath, (counter.get(scopePath) ?? 0) + 1);
    }
  }
  if ([...counter.values()].some((count) => count > 1)) reasons.push(REASON_SHARED_PATH);

  if (steps.some((step) => step.changes.some((change) => PATCH_MODES_NEEDING_FILE.includes(change.patchMode)))) {
    reasons.push(REASON_PATCH_FILES);
  }
  if (steps.some((step) => step.changes.some((change) => change.patchMode === 'content'))) {
    reasons.push(REASON_INTERMEDIATE);
  }

  if (cwd !== null && Object.keys(detectUnsupportedOperations(steps, cwd)).length > 0) {
    reasons.push(REASON_UNSUPPORTED);
  }

  return reasons;
}

/** 扫描补丁文件，返回 { 补丁文件: [不支持的操作] }。 */
export function detectUnsupportedOperations(steps, cwd) {
  const found = {};
  for (const step of steps) {
    for (const change of step.changes) {
      if (!PATCH_MODES_NEEDING_FILE.includes(change.patchMode)) continue;
      const patchPath = resolvePatchPath(cwd, change.patchFile);
      if (!patchPath || !fs.existsSync(patchPath) || !fs.statSync(patchPath).isFile()) continue;
      const text = fs.readFileSync(patchPath, 'utf8');
      const [, unsupported] = scanPatch(text);
      if (unsupported.length > 0) {
        found[change.patchFile] = [...new Set(unsupported)].sort();
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 依赖排序
// ---------------------------------------------------------------------------

/** 按 depends_on 做拓扑排序。同层步骤保持计划中的原始顺序。 */
export function topologicalOrder(steps) {
  const byNumber = new Map();
  for (const step of steps) {
    if (byNumber.has(step.step)) {
      throw new PlanError(CODE_INVALID_PLAN, `duplicate step number: ${step.step}`);
    }
    byNumber.set(step.step, step);
  }

  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!byNumber.has(dependency)) {
        throw new PlanError(CODE_INVALID_PLAN, `step ${step.step} depends on unknown step ${dependency}`);
      }
    }
  }

  const state = new Map();
  const ordered = [];

  const visit = (step) => {
    const mark = state.get(step.step);
    if (mark === 1) return;
    if (mark === 0) {
      throw new PlanError(CODE_DEPENDENCY_CYCLE, `dependency cycle detected at step ${step.step}`);
    }
    state.set(step.step, 0);
    for (const dependency of step.dependsOn) {
      visit(byNumber.get(dependency));
    }
    state.set(step.step, 1);
    ordered.push(step);
  };

  for (const step of steps) {
    visit(step);
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// 路径处理
// ---------------------------------------------------------------------------

/** 把计划中的仓库相对路径解析为绝对路径，并拒绝越界路径。 */
export function resolveRepoPath(cwd, pathText) {
  if (path.isAbsolute(pathText)) {
    throw new PlanError(CODE_INVALID_PLAN, `path must be repository relative: ${pathText}`);
  }
  const resolved = path.resolve(cwd, pathText);
  const relative = path.relative(path.resolve(cwd), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PlanError(CODE_INVALID_PLAN, `path escapes the repository: ${pathText}`);
  }
  return resolved;
}

/** 解析补丁文件路径。补丁文件可以位于仓库内，也可以位于仓库外。 */
export function resolvePatchPath(cwd, patchFile) {
  if (!patchFile) return null;
  if (path.isAbsolute(patchFile)) return patchFile;
  return path.resolve(cwd, patchFile);
}

// ---------------------------------------------------------------------------
// Git 调用
// ---------------------------------------------------------------------------
function gitEnv(env) {
  return env ? { ...process.env, ...env } : process.env;
}

/** 以文本方式运行 git。 */
export function runGit(args, cwd, env = null) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: gitEnv(env),
    maxBuffer: MAX_GIT_OUTPUT,
    windowsHide: true,
  });
  return {
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** 以二进制方式运行 git。input 用于把补丁字节送入 stdin。 */
export function runGitBuffer(args, cwd, input = null, env = null) {
  const result = spawnSync('git', args, {
    cwd,
    input,
    env: gitEnv(env),
    maxBuffer: MAX_GIT_OUTPUT,
    windowsHide: true,
  });
  return {
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
  };
}

// ---------------------------------------------------------------------------
// 补丁扫描
// ---------------------------------------------------------------------------

/**
 * 解码 Git 的 C 风格转义字符串。
 *
 * Git 在路径含非 ASCII 或控制字符时会把路径包进引号，并把非 ASCII 字节写成
 * 八进制转义。例如 `文.txt` 输出为 `"\346\226\207.txt"`。
 */
export function unescapeGitString(text) {
  const bytes = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char !== '\\') {
      for (const byte of Buffer.from(char, 'utf8')) bytes.push(byte);
      index += 1;
      continue;
    }
    const next = text[index + 1];
    if (next >= '0' && next <= '7') {
      const octal = text.slice(index + 1, index + 4);
      if (/^[0-7]{3}$/.test(octal)) {
        bytes.push(Number.parseInt(octal, 8));
        index += 4;
        continue;
      }
    }
    const escapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '\\': 92, '"': 34 };
    if (next !== undefined && Object.hasOwn(escapes, next)) {
      bytes.push(escapes[next]);
      index += 2;
      continue;
    }
    for (const byte of Buffer.from(char, 'utf8')) bytes.push(byte);
    index += 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

/** 解码 Git 输出中的路径。带引号时先脱引号，再解八进制转义。 */
export function decodeGitPath(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return unescapeGitString(trimmed.slice(1, -1));
  }
  return trimmed;
}

/** 去掉 unified diff 中的 a/ 或 b/ 前缀。 */
function stripDiffPrefix(pathText) {
  if (pathText.startsWith('a/') || pathText.startsWith('b/')) return pathText.slice(2);
  return pathText;
}

/** 解析 --- / +++ 行中的路径。 */
function parseDiffPath(text) {
  let value = text.trim();
  const tabIndex = value.indexOf('\t');
  if (tabIndex !== -1) value = value.slice(0, tabIndex);
  value = value.trim();
  if (value === '/dev/null') return null;
  return stripDiffPrefix(decodeGitPath(value));
}

/** 解析 `diff --git a/x b/y` 行中的两个路径。 */
function parseDiffGitPaths(line) {
  const rest = line.slice('diff --git '.length).trim();
  const quoted = rest.match(/^"((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"$/);
  if (quoted) {
    return [
      stripDiffPrefix(unescapeGitString(quoted[1])),
      stripDiffPrefix(unescapeGitString(quoted[2])),
    ];
  }
  const marker = ' b/';
  const index = rest.lastIndexOf(marker);
  if (index === -1) {
    const parts = rest.split(' ');
    if (parts.length < 2) return [null, null];
    return [stripDiffPrefix(decodeGitPath(parts[0])), stripDiffPrefix(decodeGitPath(parts[parts.length - 1]))];
  }
  return [
    stripDiffPrefix(decodeGitPath(rest.slice(0, index))),
    stripDiffPrefix(decodeGitPath(rest.slice(index + 1))),
  ];
}

/**
 * 扫描补丁，返回 [涉及路径, 不支持的操作]。
 *
 * 不支持的操作包括二进制补丁、重命名和复制。这些操作必须显式支持，执行器不得猜测。
 */
export function scanPatch(text) {
  const paths = new Set();
  const unsupported = [];
  // hunk 正文里的行也可能是 `--- a/x` 这类内容。只有第一个 @@ 之前的行才是文件头。
  let inHunk = false;

  for (const line of text.split(/\r\n|\n|\r/)) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      const [oldPath, newPath] = parseDiffGitPaths(line);
      if (oldPath) paths.add(oldPath);
      if (newPath) paths.add(newPath);
      if (oldPath && newPath && oldPath !== newPath) unsupported.push('rename');
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      if (inHunk) continue;
      const diffPath = parseDiffPath(line.slice(line.startsWith('--- ') ? 4 : 4));
      if (diffPath) paths.add(diffPath);
    } else if (line.startsWith('GIT binary patch') || line.startsWith('Binary files ')) {
      unsupported.push('binary');
    } else if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
      unsupported.push('rename');
    } else if (line.startsWith('copy from ') || line.startsWith('copy to ')) {
      unsupported.push('copy');
    } else if (!inHunk && (line.startsWith('old mode ') || line.startsWith('new mode '))) {
      // 模式变更只存在于 index，无法从工作区推导目标树。必须在提交前拒绝，
      // 否则补丁会先落地，再因目标树不匹配而报失败。
      unsupported.push('mode');
    }
  }

  return [[...paths], unsupported];
}

// ---------------------------------------------------------------------------
// 计划校验
// ---------------------------------------------------------------------------

/** 校验语义计划。任一检查失败时抛出 PlanError。 */
export function validateSemanticPlan(steps, cwd) {
  if (steps.length === 0) {
    throw new PlanError(CODE_INVALID_PLAN, 'semantic plan contains no steps');
  }

  for (const step of steps) {
    if (step.changes.length === 0) {
      throw new PlanError(
        CODE_INVALID_PLAN,
        `step ${step.step} must declare changes in semantic mode; file-level staging is not allowed`,
      );
    }
    for (const change of step.changes) {
      if (!change.path) {
        throw new PlanError(CODE_INVALID_PLAN, `step ${step.step} change is missing path`);
      }
      if (!PATCH_MODES.includes(change.patchMode)) {
        throw new PlanError(
          CODE_INVALID_PLAN,
          `step ${step.step} change ${change.path} uses unknown patch mode: ${change.patchMode}`,
        );
      }
      if (!change.patchFile) {
        throw new PlanError(CODE_INVALID_PLAN, `step ${step.step} change ${change.path} is missing patch_file`);
      }
      resolveRepoPath(cwd, change.path);
      const patchPath = resolvePatchPath(cwd, change.patchFile);
      if (!patchPath || !fs.existsSync(patchPath) || !fs.statSync(patchPath).isFile()) {
        throw new PlanError(
          CODE_INVALID_PLAN,
          `step ${step.step} change ${change.path} references a missing patch file: ${change.patchFile}`,
        );
      }
    }
  }
}

/** 收集整个计划涉及的全部路径。 */
export function collectScope(steps) {
  const scope = new Set();
  for (const step of steps) {
    for (const scopePath of stepScopePaths(step)) {
      scope.add(scopePath);
    }
  }
  return [...scope].sort();
}

/** 确认范围内的每个路径在工作区或基线提交中存在。 */
export function validateScopePaths(cwd, scope, baseHead) {
  const tracked = new Set();
  if (baseHead) {
    const result = runGit(['ls-tree', '-r', '--name-only', baseHead], cwd);
    if (result.status === 0) {
      for (const line of result.stdout.split(/\r\n|\n|\r/)) {
        if (line.trim()) tracked.add(line.trim());
      }
    }
  }

  for (const scopePath of scope) {
    if (tracked.has(scopePath)) continue;
    if (fs.existsSync(path.resolve(cwd, scopePath))) continue;
    throw new PlanError(
      CODE_INVALID_PLAN,
      `path does not exist in the worktree or the base commit: ${scopePath}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 暂存层
// ---------------------------------------------------------------------------

/**
 * 生成字面量 pathspec。
 *
 * 文件名含 `*`、`?` 或 `[` 时，普通 pathspec 会按通配符展开，可能匹配到无关文件。
 */
export function literalPathspec(pathText) {
  return `:(literal)${pathText}`;
}

/** 拆分 NUL 分隔的输出。 */
function splitNul(text) {
  return text.split('\0').filter((item) => item.length > 0);
}

/** 解析 `git status --porcelain -z` 的输出。 */
export function parseStatusZ(text) {
  const fields = text.split('\0');
  const entries = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field || field.length < 4) continue;
    const status = field.slice(0, 2);
    entries.push({ status, path: field.slice(3) });
    // 重命名与复制的旧路径占用下一个字段。
    if (status[0] === 'R' || status[0] === 'C') index += 1;
  }
  return entries;
}

/** 暂存区必须为空。返回错误字典，或返回 null。 */
export function ensureCleanIndex(cwd) {
  const result = runGit(['diff', '--cached', '--name-only', '-z'], cwd);
  if (result.status !== 0) {
    return {
      ok: false,
      code: CODE_GIT_FAILED,
      message: 'failed to inspect the index',
      command: ['git', 'diff', '--cached', '--name-only', '-z'],
      returncode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  const staged = splitNul(result.stdout);
  if (staged.length > 0) {
    return {
      ok: false,
      code: CODE_STAGED_CHANGES,
      message: 'current index already has staged changes; aborting to avoid committing unplanned content',
      staged_files: staged,
    };
  }
  return null;
}

/**
 * 清空暂存区。
 *
 * `git reset --quiet` 是混合重置，只把 index 恢复到 HEAD，不改动工作区文件。
 * 兜底用 `git read-tree HEAD`，它同样只写 index，且不会删除 index 条目。
 */
export function clearIndex(cwd) {
  const result = runGit(['reset', '--quiet'], cwd);
  if (result.status === 0) return [true, ''];

  const head = currentHead(cwd);
  if (head) {
    const readTree = runGit(['read-tree', head], cwd);
    if (readTree.status === 0) return [true, ''];
    return [false, readTree.stderr || result.stderr];
  }

  // 没有 HEAD 时 index 本应为空。
  const fallback = runGit(['rm', '--cached', '-r', '--quiet', '--ignore-unmatch', '--', '.'], cwd);
  if (fallback.status === 0) return [true, ''];
  return [false, result.stderr || fallback.stderr];
}

/**
 * 返回暂存区中与 HEAD 不同的路径。
 *
 * 必须用 `--no-renames`。Git 默认启用重命名探测，`--name-only` 会把
 * 「删除旧路径 + 新增新路径」折叠成一条新路径记录，旧路径因此从枚举里消失。
 * 计划外的删除一旦被折叠进一次重命名，范围检查就看不到它。
 *
 * 出错时返回错误信息，调用方必须把它当作失败，不能当成空列表。
 */
export function stagedPaths(cwd) {
  const result = runGit(['diff', '--cached', '--name-only', '--no-renames', '-z'], cwd);
  if (result.status !== 0) {
    return { paths: [], error: result.stderr.trim() };
  }
  return { paths: splitNul(result.stdout), error: null };
}

/**
 * 判断暂存区是否存在差异。
 *
 * `git diff --cached --quiet` 的退出码：0 表示无差异，1 表示有差异，更大表示出错。
 * 出错不能当成无差异。
 */
export function stagedDiffState(cwd) {
  const result = runGit(['diff', '--cached', '--quiet'], cwd);
  if (result.status === 1) return { hasDiff: true, error: null };
  if (result.status === 0) return { hasDiff: false, error: null };
  return { hasDiff: false, error: result.stderr.trim() || `git diff --cached --quiet exited with ${result.status}` };
}

/** 把一个变更写入 index。返回结构化结果，或抛出 PlanError。 */
export function stageChange(cwd, change, scope) {
  const patchPath = resolvePatchPath(cwd, change.patchFile);
  if (!patchPath || !fs.existsSync(patchPath) || !fs.statSync(patchPath).isFile()) {
    throw new PlanError(
      CODE_INVALID_PLAN,
      `change ${change.path} references a missing patch file: ${change.patchFile}`,
    );
  }

  if (change.patchMode === 'content') {
    return stageContent(cwd, change, patchPath);
  }

  const raw = fs.readFileSync(patchPath);
  const text = raw.toString('utf8');
  const [patchPaths, unsupported] = scanPatch(text);
  if (unsupported.length > 0) {
    throw new PlanError(
      CODE_UNSUPPORTED_OP,
      `change ${change.path} uses an unsupported operation: ${[...new Set(unsupported)].sort().join(', ')}`,
      null,
      { patch_file: change.patchFile },
    );
  }

  const outside = patchPaths.filter((patchPathText) => !scope.includes(patchPathText)).sort();
  if (outside.length > 0) {
    throw new PlanError(
      CODE_SCOPE_MISMATCH,
      `change ${change.path} patch touches paths outside the declared scope: ${outside.join(', ')}`,
      null,
      { patch_file: change.patchFile, out_of_scope_paths: outside },
    );
  }

  if (patchPaths.length === 0) {
    // 空补丁不产生任何变更。它既不报错，也不扩大提交范围。
    return { applied: false, reason: 'empty_patch', paths: [] };
  }

  const args = ['apply', '--cached', `--whitespace=${change.whitespace}`];
  if (change.patchMode === '3way') args.push('--3way');
  args.push('-');
  const result = runGitBuffer(args, cwd, raw);
  if (result.status !== 0) {
    const message = result.stderr.toString('utf8').trim();
    throw new PlanError(
      CODE_PATCH_APPLY,
      `failed to apply the patch for ${change.path}: ${message}`,
      null,
      { patch_file: change.patchFile, stderr: message },
    );
  }

  const unmerged = runGit(['ls-files', '-u'], cwd);
  if (unmerged.status === 0 && unmerged.stdout.trim()) {
    throw new PlanError(
      CODE_PATCH_APPLY,
      `the patch for ${change.path} left unresolved conflicts in the index`,
      null,
      { patch_file: change.patchFile },
    );
  }

  return { applied: true, paths: [...patchPaths].sort() };
}

/** 用中间状态文件的完整内容替换 index 中的路径。 */
function stageContent(cwd, change, contentPath) {
  const data = fs.readFileSync(contentPath);
  const hashed = runGitBuffer(['hash-object', '-w', '--stdin', `--path=${change.path}`], cwd, data);
  if (hashed.status !== 0) {
    const message = hashed.stderr.toString('utf8').trim();
    throw new PlanError(
      CODE_PATCH_APPLY,
      `failed to hash the intermediate state for ${change.path}: ${message}`,
      null,
      { patch_file: change.patchFile },
    );
  }
  const blob = hashed.stdout.toString('utf8').trim();

  let mode = '100644';
  const listing = runGit(['ls-files', '-s', '--', literalPathspec(change.path)], cwd);
  if (listing.status === 0 && listing.stdout.trim()) {
    mode = listing.stdout.trim().split(/\s+/)[0];
  }

  const updated = runGit(['update-index', '--add', '--cacheinfo', `${mode},${blob},${change.path}`], cwd);
  if (updated.status !== 0) {
    throw new PlanError(
      CODE_PATCH_APPLY,
      `failed to write the intermediate state for ${change.path} into the index: ${updated.stderr.trim()}`,
      null,
      { patch_file: change.patchFile },
    );
  }
  return { applied: true, paths: [change.path] };
}

// ---------------------------------------------------------------------------
// 目标快照层
// ---------------------------------------------------------------------------

/** 返回当前 HEAD 的提交号。没有提交时返回空字符串。 */
export function currentHead(cwd) {
  const result = runGit(['rev-parse', 'HEAD'], cwd);
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

/**
 * 用临时 index 构造范围路径的目标树。
 *
 * 临时 index 从基线提交读入，再叠加工作区内容。这样得到的目标树只包含
 * 范围内路径的改动，不受计划工件（例如补丁文件）影响。
 */
export function writeScopeTree(cwd, baseHead, scope) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-up-target-'));
  const indexPath = path.join(tmpDir, 'index');
  const env = { GIT_INDEX_FILE: indexPath };
  try {
    if (baseHead) {
      const read = runGit(['read-tree', baseHead], cwd, env);
      if (read.status !== 0) {
        throw new PlanError(
          CODE_GIT_FAILED,
          `failed to read the base commit into a temporary index: ${read.stderr.trim()}`,
        );
      }
    }
    const added = runGit(['add', '-A', '--', ...scope.map(literalPathspec)], cwd, env);
    if (added.status !== 0) {
      throw new PlanError(CODE_INVALID_PLAN, `failed to build the target snapshot: ${added.stderr.trim()}`);
    }
    const written = runGit(['write-tree'], cwd, env);
    if (written.status !== 0) {
      throw new PlanError(
        CODE_GIT_FAILED,
        `failed to write the target snapshot tree: ${written.stderr.trim()}`,
      );
    }
    return written.stdout.trim();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** 记录执行前的目标状态。 */
export function captureTargetSnapshot(cwd, scope) {
  const baseHead = currentHead(cwd);
  validateScopePaths(cwd, scope, baseHead);
  const targetTree = writeScopeTree(cwd, baseHead, scope);

  const tracked = runGit(['ls-files', '-s'], cwd);
  const trackedMeta = {};
  if (tracked.status === 0) {
    for (const line of tracked.stdout.split(/\r\n|\n|\r/)) {
      const parts = line.split('\t');
      if (parts.length !== 2) continue;
      const meta = parts[0].split(/\s+/).filter(Boolean);
      if (meta.length >= 2) trackedMeta[parts[1]] = `${meta[0]} ${meta[1]}`;
    }
  }

  const status = runGit(['status', '--porcelain=v1', '-uall', '-z'], cwd);
  const untracked = {};
  if (status.status === 0) {
    for (const entry of parseStatusZ(status.stdout)) {
      if (entry.status !== '??') continue;
      untracked[entry.path] = fileDigest(path.resolve(cwd, entry.path));
    }
  }

  const diffStat = baseHead ? runGit(['diff', 'HEAD', '--stat'], cwd) : null;
  const diffFull = baseHead ? runGit(['diff', 'HEAD'], cwd) : null;

  return {
    base_head: baseHead,
    target_tree: targetTree,
    scope_paths: [...scope],
    tracked_files: trackedMeta,
    untracked_files: untracked,
    target_diff: diffFull ? diffFull.stdout : '',
    target_diff_stat: diffStat ? diffStat.stdout.trim() : '',
  };
}

/** 计算文件内容的 SHA-256。文件不存在时返回空字符串。 */
export function fileDigest(filePath) {
  try {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// 最终校验层
// ---------------------------------------------------------------------------

/** 比较最终 HEAD 与目标快照。 */
export function verifyTarget(cwd, snapshot) {
  const treeResult = runGit(['rev-parse', 'HEAD^{tree}'], cwd);
  const finalTree = treeResult.status === 0 ? treeResult.stdout.trim() : '';

  const scope = [...(snapshot.scope_paths ?? [])];
  const targetTree = snapshot.target_tree ?? '';

  const treeMatch = Boolean(finalTree) && finalTree === targetTree;

  const scopeStatus = runGit(
    ['status', '--porcelain=v1', '-uall', '-z', '--', ...scope.map(literalPathspec)],
    cwd,
  );
  const scopeClean = scopeStatus.status === 0 && !scopeStatus.stdout.trim();

  const indexResult = runGit(['diff', '--cached', '--name-only', '-z'], cwd);
  const indexClean = indexResult.status === 0 && !indexResult.stdout.trim();

  const leftovers = [];
  const fullStatus = runGit(['status', '--porcelain=v1', '-uall', '-z'], cwd);
  if (fullStatus.status === 0) {
    for (const entry of parseStatusZ(fullStatus.stdout)) {
      if (!scope.includes(entry.path)) leftovers.push(entry.path);
    }
  }

  const ok = treeMatch && scopeClean && indexClean;
  return {
    ok,
    status: ok ? 'verified' : 'failed',
    target_tree: targetTree,
    final_tree: finalTree,
    tree_match: treeMatch,
    scope_worktree_clean: scopeClean,
    index_clean: indexClean,
    out_of_scope_changes: [...leftovers].sort(),
    reason: ok ? '' : verificationReason(treeMatch, scopeClean, indexClean),
  };
}

/** 说明校验失败的原因。 */
function verificationReason(treeMatch, scopeClean, indexClean) {
  const problems = [];
  if (!treeMatch) problems.push('final tree does not match the target tree');
  if (!scopeClean) problems.push('worktree still differs from the target inside the declared scope');
  if (!indexClean) problems.push('index still holds staged changes');
  return problems.join('; ');
}

// ---------------------------------------------------------------------------
// 语义执行器
// ---------------------------------------------------------------------------

/** 按语义计划执行提交，并验证最终状态与目标快照一致。 */
export function executeSemanticPlan(steps, cwd) {
  const preflight = ensureCleanIndex(cwd);
  if (preflight !== null) return preflight;

  let ordered;
  let scope;
  let snapshot;
  try {
    validateSemanticPlan(steps, cwd);
    ordered = topologicalOrder(steps);
    scope = collectScope(steps);
    snapshot = captureTargetSnapshot(cwd, scope);
  } catch (error) {
    if (error instanceof PlanError) return error.toDict();
    throw error;
  }

  const completed = [];
  const skipped = [];

  for (const step of ordered) {
    const scope = stepScopePaths(step);
    const [cleared, message] = clearIndex(cwd);
    if (!cleared) {
      return {
        ok: false,
        code: CODE_GIT_FAILED,
        message: `failed to clear the index before step ${step.step}: ${message.trim()}`,
        completed_steps: completed,
      };
    }

    const staged = [];
    const emptyChanges = [];
    try {
      for (const change of step.changes) {
        const outcome = stageChange(cwd, change, scope);
        if (outcome.applied) {
          staged.push(...outcome.paths);
        } else {
          emptyChanges.push(`${change.path} (patch_file: ${change.patchFile})`);
        }
      }
    } catch (error) {
      if (!(error instanceof PlanError)) throw error;
      const payload = error.toDict();
      payload.step = step.step;
      payload.completed_steps = completed;
      // 失败时把 index 恢复到 HEAD，避免把计划外内容留在暂存区。
      clearIndex(cwd);
      return payload;
    }

    const stagedResult = stagedPaths(cwd);
    if (stagedResult.error) {
      clearIndex(cwd);
      return {
        ok: false,
        code: CODE_GIT_FAILED,
        message: `failed to inspect the staged paths at step ${step.step}: ${stagedResult.error}`,
        step: step.step,
        completed_steps: completed,
      };
    }
    const actual = stagedResult.paths;
    const outside = actual.filter((item) => !scope.includes(item)).sort();
    if (outside.length > 0) {
      clearIndex(cwd);
      return {
        ok: false,
        code: CODE_SCOPE_MISMATCH,
        message: `step ${step.step} staged paths outside the declared scope: ${outside.join(', ')}`,
        step: step.step,
        out_of_scope_paths: outside,
        completed_steps: completed,
      };
    }

    const diffState = stagedDiffState(cwd);
    if (diffState.error) {
      clearIndex(cwd);
      return {
        ok: false,
        code: CODE_GIT_FAILED,
        message: `failed to inspect the staged diff at step ${step.step}: ${diffState.error}`,
        step: step.step,
        completed_steps: completed,
      };
    }

    if (!diffState.hasDiff) {
      skipped.push({
        step: step.step,
        subject: step.subject,
        reason: step.reason,
        status: 'skipped',
        skip_reason:
          emptyChanges.length > 0
            ? `no effective change in this group; patch files without diff content: ${emptyChanges.join(', ')}`
            : 'no effective change in this group',
        paths: [],
      });
      continue;
    }

    const committed = commitStep(step, cwd, actual);
    if (!committed.ok) {
      committed.completed_steps = completed;
      // 提交失败时 index 仍留着本次内容，同样要恢复。
      clearIndex(cwd);
      return committed;
    }
    completed.push(committed);

    // 提交后再核对一次。钩子可能自行暂存了计划外的文件。
    const committedPaths = commitPaths(cwd);
    const committedOutside = committedPaths.filter((item) => !scope.includes(item)).sort();
    if (committedOutside.length > 0) {
      return {
        ok: false,
        code: CODE_SCOPE_MISMATCH,
        message: `step ${step.step} committed paths outside the declared scope: ${committedOutside.join(', ')}`,
        step: step.step,
        out_of_scope_paths: committedOutside,
        completed_steps: completed,
      };
    }
  }

  const verification = verifyTarget(cwd, snapshot);
  if (!verification.ok) {
    return {
      ok: false,
      code: CODE_VERIFICATION,
      message: `target verification failed: ${verification.reason}`,
      step: null,
      verification,
      completed_steps: completed,
      skipped_steps: skipped,
    };
  }

  const logCount = Math.max(completed.length, 1);
  const logResult = runGit(['log', '--oneline', `-${logCount}`], cwd);
  if (logResult.status !== 0) {
    return {
      ok: false,
      code: CODE_GIT_FAILED,
      message: 'failed to read the git log',
      completed_steps: completed,
    };
  }

  return {
    ok: true,
    mode: 'semantic',
    fast_path_used: false,
    base_head: snapshot.base_head,
    final_head: currentHead(cwd),
    target_tree: snapshot.target_tree,
    final_tree: verification.final_tree,
    completed_steps: completed,
    skipped_steps: skipped,
    verification,
    git_log: logResult.stdout.trim(),
  };
}

/**
 * 读取最近一次提交触碰的路径。
 *
 * 必须用 `--no-renames`，理由同 `stagedPaths`：重命名折叠会让被删除的旧路径
 * 从枚举里消失，提交后的范围复核就看不到计划外的删除。
 */
export function commitPaths(cwd) {
  const result = runGit(['show', '--name-only', '--no-renames', '--format=', '-z', 'HEAD'], cwd);
  if (result.status !== 0) return [];
  return splitNul(result.stdout);
}

/**
 * 提交一个步骤的暂存内容。
 *
 * paths 必须在提交前采集。提交完成后 index 与 HEAD 一致，路径列表会消失。
 */
function commitStep(step, cwd, paths) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-up-msg-'));
  const messagePath = path.join(tmpDir, 'message.txt');
  try {
    fs.writeFileSync(messagePath, stepMessage(step), 'utf8');
    const result = runGit(['commit', '-F', messagePath], cwd);
    if (result.status !== 0) {
      return {
        ok: false,
        code: CODE_COMMIT_FAILURE,
        message: `commit failed at step ${step.step}: ${result.stderr.trim()}`,
        step: step.step,
        subject: step.subject,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return {
    ok: true,
    step: step.step,
    sha: currentHead(cwd),
    subject: step.subject,
    reason: step.reason,
    paths: [...paths],
    status: 'committed',
  };
}
