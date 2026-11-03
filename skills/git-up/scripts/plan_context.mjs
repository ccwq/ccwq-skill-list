#!/usr/bin/env node
/**
 * 聚合规划上下文：一次调用返回 git-up 规划所需的全部输入。
 *
 * 规划时 agent 需要知道：哪些文件改了、改动多大、暂存区状态、以及本仓库的提交信息惯例。
 * 这些此前要分开跑多次 git 命令、读多份文档才能拼齐。这里一次返回。
 *
 * 内部的 git 调用并发执行：并发比串行快，且各调用互不写 index。
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_LOG_COUNT = 15;
const MAX_BUFFER = 64 * 1024 * 1024;

function usage() {
  return '用法：node plan_context.mjs [--cwd DIR] [--log-count N]';
}

function parseArgs(argv) {
  const options = { cwd: '.', logCount: DEFAULT_LOG_COUNT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = argv[index + 1];
      index += 1;
    } else if (arg === '--log-count') {
      options.logCount = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!Number.isInteger(options.logCount) || options.logCount < 1) {
    throw new Error('--log-count 必须是不小于 1 的整数');
  }
  return options;
}

/** 运行一条 git 命令。失败时返回错误信息，不抛异常。 */
async function git(args, cwd) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return { ok: true, stdout, stderr: '' };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error.message ?? error),
    };
  }
}

/** 解析 `git status --porcelain=v1 -z`。路径不会被引号或八进制转义。 */
function parseStatus(text) {
  const fields = text.split('\0').filter((field) => field.length > 0);
  const entries = [];
  for (const field of fields) {
    if (field.length < 4) continue;
    entries.push({ status: field.slice(0, 2), path: field.slice(3) });
  }
  return entries;
}

async function collect(cwd, logCount) {
  // 各调用互不依赖，并发执行。
  //
  // --no-optional-locks 让只读命令不去抢 index 的锁。`git status` 默认会刷新
  // index 的 stat 缓存并写回，与并发调用或随后的暂存操作相撞时可能留下
  // index.lock。这里全部是只读查询，让它们完全不碰 index 的写锁。
  const [status, diffStat, cachedStat, branch, subjects] = await Promise.all([
    git(['--no-optional-locks', 'status', '--porcelain=v1', '-uall', '-z'], cwd),
    git(['--no-optional-locks', 'diff', '--stat'], cwd),
    git(['--no-optional-locks', 'diff', '--cached', '--stat'], cwd),
    git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    git(['log', '--format=%s', `-${logCount}`], cwd),
  ]);

  const failures = [];
  if (!status.ok) failures.push(`git status 失败：${status.stderr.trim()}`);
  if (!diffStat.ok) failures.push(`git diff --stat 失败：${diffStat.stderr.trim()}`);
  if (!cachedStat.ok) failures.push(`git diff --cached --stat 失败：${cachedStat.stderr.trim()}`);
  if (!branch.ok) failures.push(`git rev-parse --abbrev-ref HEAD 失败：${branch.stderr.trim()}`);
  if (!subjects.ok) failures.push(`git log 失败：${subjects.stderr.trim()}`);

  const entries = status.ok ? parseStatus(status.stdout) : [];
  return {
    failures,
    entries,
    diffStat: diffStat.ok ? diffStat.stdout.trim() : '',
    cachedDiffStat: cachedStat.ok ? cachedStat.stdout.trim() : '',
    branch: branch.ok ? branch.stdout.trim() : '',
    subjects: subjects.ok ? subjects.stdout.split('\n').filter(Boolean) : [],
  };
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}`);
    return 2;
  }

  const cwd = path.resolve(options.cwd);
  if (!fs.existsSync(cwd)) {
    process.stderr.write(`目录不存在：${cwd}\n`);
    return 2;
  }

  const result = await collect(cwd, options.logCount);
  if (result.failures.length > 0) {
    process.stderr.write(`${result.failures.join('\n')}\n`);
    return 1;
  }

  const changed = result.entries.filter((entry) => entry.status !== '??');
  const untracked = result.entries.filter((entry) => entry.status === '??');
  const staged = result.entries.filter((entry) => ![' ', '?'].includes(entry.status[0]));

  const payload = {
    ok: true,
    cwd,
    branch: result.branch,
    // 规划直接用这份分组信息，不必再逐条跑 git status。
    status: result.entries,
    counts: {
      total: result.entries.length,
      changed: changed.length,
      staged: staged.length,
      untracked: untracked.length,
    },
    diff_stat: result.diffStat,
    cached_diff_stat: result.cachedDiffStat,
    // 最近提交标题：提交信息惯例（类型前缀、scope、emoji、措辞风格）由此推断，
    // 不必再单独翻 git log。
    recent_subjects: result.subjects,
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
