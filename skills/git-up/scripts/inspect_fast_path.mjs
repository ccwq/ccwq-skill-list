#!/usr/bin/env node
/**
 * Aggregate read-only Git checks for the git-up -pc/-pcP fast path.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  PlanError,
  parsePlan,
  parseStatusZ,
  planMode,
  runGit,
  semanticSplitReasons,
} from './gitup_semantic.mjs';

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const BINARY_SUFFIXES = new Set([
  '.7z', '.avi', '.bin', '.bmp', '.class', '.dll', '.doc', '.docx', '.exe', '.gif',
  '.gz', '.ico', '.jar', '.jpeg', '.jpg', '.mov', '.mp3', '.mp4', '.pdf', '.png',
  '.ppt', '.pptx', '.pyc', '.so', '.tar', '.webp', '.xls', '.xlsx', '.zip',
]);
const GENERATED_PARTS = new Set([
  '.next', '.nuxt', 'build', 'coverage', 'dist', 'generated', 'out', 'target',
]);
const MAX_FAST_PATH_FILE_BYTES = 5 * 1024 * 1024;

function fail(command, result) {
  return {
    ok: false,
    code: 'git_failed',
    command: ['git', ...command],
    returncode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseStatus(text) {
  // 使用 -z 输出，路径不会被引号或八进制转义。
  return parseStatusZ(text).map((entry) => ({ status: entry.status, path: entry.path }));
}

function topLevelModule(pathText) {
  const parts = pathText.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '<root>';
}

function hasReparseComponent(repo, pathText) {
  let current = repo;
  for (const part of pathText.replace(/\\/g, '/').split('/').filter(Boolean)) {
    current = path.join(current, part);
    let stats;
    try {
      stats = fs.lstatSync(current);
    } catch {
      continue;
    }
    // Node 把符号链接和 Windows 目录联接都报告为符号链接。
    if (stats.isSymbolicLink()) return true;
  }
  return false;
}

function hasNestedGitBoundary(repo, pathText) {
  let current = path.join(repo, pathText.replace(/\\/g, '/'));
  try {
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }
  // 从候选路径向上走到仓库根。途中出现嵌套 .git 目录就是边界。
  while (current !== repo) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}

function operationInProgress(repo) {
  const result = runGit(['rev-parse', '--git-dir'], repo);
  if (result.status !== 0) return false;
  let gitDir = result.stdout.trim();
  if (!path.isAbsolute(gitDir)) gitDir = path.join(repo, gitDir);
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    if (fs.existsSync(path.join(gitDir, marker))) return true;
  }
  return false;
}

/**
 * 读取计划并判定它是否需要语义拆分。
 *
 * 计划无法解析时返回 plan_valid=false，检查器据此回退到完整规划流程。
 */
export function inspectPlan(repo, planFile) {
  if (!planFile) {
    return {
      plan_valid: null,
      plan_mode: null,
      semantic_split_required: false,
      semantic_split_reasons: [],
      plan_error: null,
    };
  }

  let text;
  try {
    text = fs.readFileSync(planFile, 'utf8').replace(/^﻿/, '');
  } catch (error) {
    return {
      plan_valid: false,
      plan_mode: null,
      semantic_split_required: true,
      semantic_split_reasons: ['invalid_plan'],
      plan_error: { code: 'plan_file_read_failed', message: String(error.message ?? error) },
    };
  }

  let steps;
  try {
    steps = parsePlan(text);
  } catch (error) {
    if (error instanceof PlanError) {
      return {
        plan_valid: false,
        plan_mode: null,
        semantic_split_required: true,
        semantic_split_reasons: ['invalid_plan'],
        plan_error: { code: error.code, message: error.message },
      };
    }
    throw error;
  }

  const mode = planMode(steps);
  const reasons = semanticSplitReasons(steps, repo);
  return {
    plan_valid: true,
    plan_mode: mode,
    semantic_split_required: reasons.length > 0,
    semantic_split_reasons: reasons,
    plan_error: null,
  };
}

export function inspect(repo, maxFiles, planFile = null) {
  const statusArgs = ['status', '--porcelain=v1', '-uall', '-z'];
  const statusResult = runGit(statusArgs, repo);
  if (statusResult.status !== 0) {
    return fail(statusArgs, statusResult);
  }

  const changes = parseStatus(statusResult.stdout);
  const paths = changes.map((item) => item.path);
  const modules = [...new Set(paths.map((pathText) => topLevelModule(pathText)))].sort();
  const stagedFiles = changes.filter((item) => ![' ', '?'].includes(item.status[0])).map((item) => item.path);
  const conflictFiles = changes.filter((item) => CONFLICT_CODES.has(item.status)).map((item) => item.path);

  const reasons = [];
  if (changes.length === 0) reasons.push('no_changes');
  if (stagedFiles.length > 0) reasons.push('staged_changes_present');
  if (conflictFiles.length > 0) reasons.push('conflicts_present');
  if (operationInProgress(repo)) reasons.push('git_operation_in_progress');
  if (paths.length > maxFiles) reasons.push('file_count_exceeded');
  if (modules.length > 1) reasons.push('multiple_modules');

  const riskyFiles = [];
  for (const pathText of paths) {
    const filePath = path.join(repo, pathText.replace(/\\/g, '/'));
    const parts = new Set(pathText.replace(/\\/g, '/').split('/').filter(Boolean).map((part) => part.toLowerCase()));
    let isLarge = false;
    try {
      isLarge = fs.statSync(filePath).isFile() && fs.statSync(filePath).size > MAX_FAST_PATH_FILE_BYTES;
    } catch {
      isLarge = false;
    }
    if (
      BINARY_SUFFIXES.has(path.extname(filePath).toLowerCase()) ||
      [...parts].some((part) => GENERATED_PARTS.has(part)) ||
      isLarge ||
      hasReparseComponent(repo, pathText) ||
      hasNestedGitBoundary(repo, pathText)
    ) {
      riskyFiles.push(pathText);
    }
  }
  if (riskyFiles.length > 0) reasons.push('risky_paths_present');

  const planInfo = inspectPlan(repo, planFile);
  const planReasons = [...planInfo.semantic_split_reasons];
  for (const reason of planReasons) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }

  return {
    ok: true,
    eligible: reasons.length === 0,
    fast_path_used: false,
    fallback_reasons: reasons,
    semantic_review_required: true,
    semantic_split_required: planInfo.semantic_split_required,
    semantic_split_reasons: planReasons,
    plan_valid: planInfo.plan_valid,
    plan_mode: planInfo.plan_mode,
    plan_error: planInfo.plan_error,
    max_files: maxFiles,
    file_count: paths.length,
    modules,
    files: changes,
    staged_files: stagedFiles,
    conflict_files: conflictFiles,
    risky_files: riskyFiles,
  };
}

function parseArgs(argv) {
  const options = { cwd: '.', maxFiles: 5, planFile: null };
  const takeValue = (name, index) => {
    const value = argv[index];
    if (value === undefined) {
      throw new Error(`${name} requires a value`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cwd') {
      options.cwd = takeValue('--cwd', i + 1);
      i += 1;
    } else if (arg === '--max-files') {
      options.maxFiles = Number.parseInt(takeValue('--max-files', i + 1), 10);
      i += 1;
    } else if (arg === '--plan-file') {
      options.planFile = takeValue('--plan-file', i + 1);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const USAGE = `usage: inspect_fast_path.mjs [--cwd DIR] [--max-files N] [--plan-file FILE]

检查 -pc/-pcP 是否可以使用快车道。--plan-file 指定的计划若需要语义拆分，
检查器会回退快车道并给出原因。
`;

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
  } else {
    if (!Number.isInteger(options.maxFiles) || options.maxFiles < 1) {
      process.stderr.write('--max-files must be at least 1\n');
      process.exitCode = 2;
    } else {
      const payload = inspect(path.resolve(options.cwd), options.maxFiles, options.planFile);
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exitCode = payload.ok ? 0 : 1;
    }
  }
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n${USAGE}`);
  process.exitCode = 2;
}
