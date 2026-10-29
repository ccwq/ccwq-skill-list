#!/usr/bin/env node
/**
 * Execute a git-up YAML-lite commit plan.
 *
 * The parser intentionally supports only the small YAML subset emitted by
 * git-up -p. It is not a general YAML parser.
 *
 * Two execution modes are supported:
 *
 * - File mode: a plan that declares `files`. Each step stages exactly the
 *   listed paths with `git add -- <files...>`.
 * - Semantic mode: a plan that declares `changes`. Each step applies its own
 *   patch to the index, so one file can be split across several commits.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  CODE_INVALID_PLAN,
  PlanError,
  clearIndex,
  collectScope,
  ensureCleanIndex,
  executeSemanticPlan,
  literalPathspec,
  parsePlan,
  planMode,
  runGit,
  semanticSplitReasons,
  stagedDiffState,
  stagedPaths,
  stepMessage,
  stepToDict,
  validateSemanticPlan,
} from './gitup_semantic.mjs';

/** 读取 stdin 的全部内容。 */
async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function failGit(step, completed, command, result) {
  return {
    ok: false,
    code: 'git_failed',
    step,
    completed_steps: completed,
    command,
    returncode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** 执行兼容的文件级计划。每个步骤只暂存计划显式列出的路径。 */
export function executeFilePlan(steps, cwd, fastPathUsed = false) {
  const preflight = ensureCleanIndex(cwd);
  if (preflight !== null) return preflight;

  const completed = [];
  const skipped = [];
  const commits = [];

  for (const item of steps) {
    const addResult = runGit(['add', '--', ...item.files.map(literalPathspec)], cwd);
    if (addResult.status !== 0) {
      clearIndex(cwd);
      return failGit(item.step, completed, ['git', 'add', '--', ...item.files], addResult);
    }

    const diffState = stagedDiffState(cwd);
    if (diffState.error) {
      clearIndex(cwd);
      return {
        ok: false,
        code: 'git_failed',
        step: item.step,
        message: `failed to inspect the staged diff: ${diffState.error}`,
        completed_steps: completed,
      };
    }

    if (!diffState.hasDiff) {
      skipped.push(item.step);
      continue;
    }

    const stagedResult = stagedPaths(cwd);
    if (stagedResult.error) {
      clearIndex(cwd);
      return {
        ok: false,
        code: 'git_failed',
        step: item.step,
        message: `failed to inspect the staged paths: ${stagedResult.error}`,
        completed_steps: completed,
      };
    }
    const paths = stagedResult.paths;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-up-msg-'));
    const messagePath = path.join(tmpDir, 'message.txt');
    let commitResult;
    try {
      fs.writeFileSync(messagePath, stepMessage(item), 'utf8');
      commitResult = runGit(['commit', '-F', messagePath], cwd);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    if (commitResult.status !== 0) {
      clearIndex(cwd);
      return failGit(item.step, completed, ['git', 'commit', '-F', '<tempfile>'], commitResult);
    }
    completed.push(item.step);
    commits.push({
      step: item.step,
      sha: runGit(['rev-parse', 'HEAD'], cwd).stdout.trim(),
      subject: item.subject,
      paths,
      status: 'committed',
    });
  }

  const logCount = Math.max(completed.length, 1);
  const logResult = runGit(['log', '--oneline', `-${logCount}`], cwd);
  if (logResult.status !== 0) {
    return failGit(null, completed, ['git', 'log', '--oneline', `-${logCount}`], logResult);
  }

  return {
    ok: true,
    mode: 'file',
    fast_path_used: fastPathUsed,
    completed_steps: completed,
    skipped_steps: skipped,
    commits,
    git_log: logResult.stdout.trim(),
  };
}

/** 按计划模式选择执行器。语义模式不会回退到文件级暂存。 */
export function executePlan(steps, cwd, fastPathUsed = false) {
  if (planMode(steps) === 'semantic') {
    if (fastPathUsed) {
      return {
        ok: false,
        code: CODE_INVALID_PLAN,
        message: 'the fast path cannot execute a semantic plan; run the full planning flow instead',
      };
    }
    return executeSemanticPlan(steps, cwd);
  }
  return executeFilePlan(steps, cwd, fastPathUsed);
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = { mode: null, cwd: '.', planFile: null, fastPath: false };
  const takeValue = (name, index) => {
    const value = argv[index];
    if (value === undefined) {
      throw new Error(`${name} requires a value`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'parse' || arg === 'commit') {
      options.mode = arg;
    } else if (arg === '--cwd') {
      options.cwd = takeValue('--cwd', i + 1);
      i += 1;
    } else if (arg === '--plan-file') {
      options.planFile = takeValue('--plan-file', i + 1);
      i += 1;
    } else if (arg === '--fast-path') {
      options.fastPath = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const USAGE = `usage: commit_plan.mjs {parse|commit} [--cwd DIR] [--plan-file FILE] [--fast-path]

Parse or execute a git-up YAML-lite commit plan.

  parse            解析计划并输出结构化结果，不做任何 Git 写操作
  commit           按计划执行提交
  --cwd DIR        Git 仓库工作目录，默认当前目录
  --plan-file FILE 从 UTF-8 文件读取计划（Windows PowerShell 推荐）
  --fast-path      标记本次执行是已校验的 -pc/-pcP 快车道
`;

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    return 2;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!options.mode) {
    process.stderr.write(USAGE);
    return 2;
  }

  const cwd = path.resolve(options.cwd);
  let text;
  try {
    // 读取 UTF-8 文件可避开 PowerShell 5.1 原生管道把中文和 emoji 替换成 ? 的问题。
    text = options.planFile
      ? fs.readFileSync(options.planFile, 'utf8').replace(/^﻿/, '')
      : await readStdin();
  } catch (error) {
    printJson({ ok: false, code: 'plan_file_read_failed', message: String(error.message ?? error) });
    return 2;
  }

  let steps;
  try {
    steps = parsePlan(text);
  } catch (error) {
    if (error instanceof PlanError) {
      printJson(error.toDict());
      return 2;
    }
    throw error;
  }

  const mode = planMode(steps);

  if (options.mode === 'parse') {
    const payload = { ok: true, plan_mode: mode, steps: steps.map((item) => stepToDict(item)) };
    try {
      if (mode === 'semantic') {
        validateSemanticPlan(steps, cwd);
        payload.semantic_split_reasons = semanticSplitReasons(steps, cwd);
        payload.scope_paths = collectScope(steps);
      }
    } catch (error) {
      if (error instanceof PlanError) {
        printJson(error.toDict());
        return 2;
      }
      throw error;
    }
    printJson(payload);
    return 0;
  }

  const result = executePlan(steps, cwd, options.fastPath);
  printJson(result);
  return result.ok ? 0 : 1;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
