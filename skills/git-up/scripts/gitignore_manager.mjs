#!/usr/bin/env node
/**
 * Detect project stacks and maintain a conservative .gitignore file.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const STACK_MARKERS = {
  node: ['package.json'],
  python: ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'poetry.lock', 'uv.lock'],
};

const STACK_GROUPS = {
  node: {
    title: 'Git-up：Node.js 依赖与包管理日志（可通过包管理器重新生成）',
    rules: ['node_modules/', 'npm-debug.log*', 'yarn-debug.log*', 'yarn-error.log*', 'pnpm-debug.log*'],
  },
  python: {
    title: 'Git-up：Python 虚拟环境与解释器缓存（可重新生成）',
    rules: ['.venv/', 'venv/', '__pycache__/', '*.py[cod]'],
  },
};

const OS_GROUP = {
  title: 'Git-up：操作系统生成的元数据文件（与源码无关）',
  rules: ['.DS_Store', 'Thumbs.db'],
};

const IDE_MARKERS = {
  '.idea': '.idea/',
  '.history': '.history/',
};

/** 返回根目录存在清单文件的技术栈。 */
export function detectStacks(cwd) {
  return Object.keys(STACK_MARKERS).filter((stack) =>
    STACK_MARKERS[stack].some((marker) => {
      try {
        return fs.statSync(path.join(cwd, marker)).isFile();
      } catch {
        return false;
      }
    }),
  );
}

/** 读取不带行尾符的行，并保留文件的换行约定。 */
export function readIgnore(filePath) {
  if (!fs.existsSync(filePath)) return { lines: [], newline: '\n' };
  const content = fs.readFileSync(filePath, 'utf8');
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  return { lines: content.split(/\r\n|\n|\r/), newline };
}

/** 返回文件中已存在的非注释忽略规则。 */
export function existingRules(lines) {
  const rules = new Set();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    rules.add(trimmed);
  }
  return rules;
}

/** 构造本仓库保守的自动规则集合。 */
export function autoGroups(cwd, stacks) {
  const groups = [OS_GROUP];
  for (const stack of stacks) groups.push(STACK_GROUPS[stack]);
  const ideRules = Object.entries(IDE_MARKERS)
    .filter(([directory]) => {
      try {
        return fs.statSync(path.join(cwd, directory)).isDirectory();
      } catch {
        return false;
      }
    })
    .map(([, rule]) => rule);
  if (ideRules.length > 0) {
    groups.push({ title: 'Git-up：IDE 本地工作区配置（由编辑器生成）', rules: ideRules });
  }
  return groups;
}

/** 只追加缺失的规则。用户手写内容在未改动时保持逐字节不变。 */
export function appendGroups(lines, groups) {
  const knownRules = existingRules(lines);
  const result = [...lines];
  const addedGroups = [];
  const skipped = [];

  for (const group of groups) {
    const missing = group.rules.filter((rule) => !knownRules.has(rule));
    skipped.push(...group.rules.filter((rule) => knownRules.has(rule)));
    if (missing.length === 0) continue;
    if (result.length > 0 && result[result.length - 1].trim()) result.push('');
    result.push(`# ${group.title}`);
    result.push(...missing);
    for (const rule of missing) knownRules.add(rule);
    addedGroups.push({ title: group.title, rules: missing });
  }
  return { lines: result, addedGroups, skipped };
}

/** 校验自定义规则，保证生成的 .gitignore 保持逐行可读。 */
export function validateCustomRules(rules, reason) {
  if (rules.length === 0) {
    if (reason) throw new Error('--reason 必须与 --add 一起使用');
    return null;
  }
  if (!reason || !reason.trim()) {
    throw new Error('使用 --add 时必须同时提供 --reason 中文说明');
  }
  const normalized = [];
  for (const rule of rules) {
    const candidate = rule.trim();
    if (!candidate || rule.includes('\n') || candidate.startsWith('#')) {
      throw new Error('--add 规则必须是非空、单行且不能以 # 开头');
    }
    normalized.push(candidate);
  }
  return { title: `Git-up：${reason.trim()}`, rules: normalized };
}

/** 返回由 Git-up 注释块直接拥有的规则行号。 */
export function gitUpBlockLines(lines) {
  const owned = new Set();
  let inBlock = false;
  lines.forEach((line, index) => {
    const stripped = line.trim();
    if (stripped.startsWith('# Git-up：')) {
      inBlock = true;
      return;
    }
    if (stripped.startsWith('#') && stripped) {
      inBlock = false;
      return;
    }
    if (inBlock && stripped) owned.add(index);
  });
  return owned;
}

/** 只删除 Git-up 管理区块中的重复规则。绝不删除手写规则。 */
export function cleanDuplicateRules(lines) {
  const owned = gitUpBlockLines(lines);
  const seen = new Set();
  const removeIndexes = new Set();
  const removals = [];
  lines.forEach((line, index) => {
    const pattern = line.trim();
    if (!pattern || pattern.startsWith('#')) return;
    if (seen.has(pattern) && owned.has(index)) {
      removeIndexes.add(index);
      removals.push({ line: index + 1, rule: pattern, reason: 'Git-up 管理区块中的等价规则重复' });
    } else {
      seen.add(pattern);
    }
  });
  return {
    lines: lines.filter((_, index) => !removeIndexes.has(index)),
    removals,
  };
}

/** 只在确实改动后写入规范化行尾的文件。 */
export function writeIgnore(filePath, lines, newline) {
  fs.writeFileSync(filePath, `${lines.join(newline).replace(/\s+$/, '')}${newline}`, 'utf8');
}

function parseArgs(argv) {
  const options = { stacks: [], cwd: '.', add: [], reason: null, clean: false, apply: false, dryRun: false };
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
    } else if (arg === '--add') {
      options.add.push(takeValue('--add', i + 1));
      i += 1;
    } else if (arg === '--reason') {
      options.reason = takeValue('--reason', i + 1);
      i += 1;
    } else if (arg === '--clean') {
      options.clean = true;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown argument: ${arg}`);
    } else {
      options.stacks.push(arg);
    }
  }
  return options;
}

const USAGE = `usage: gitignore_manager.mjs [node|python] [--cwd DIR] [--add RULE] [--reason TEXT]
                         [--clean] [--apply] [--dry-run]

识别项目技术栈并安全维护 .gitignore。
`;

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

/** 执行维护流程，返回进程退出码。 */
export function run(options) {
  const knownStacks = Object.keys(STACK_GROUPS);
  for (const stack of options.stacks) {
    if (!knownStacks.includes(stack)) {
      process.stderr.write(`invalid choice: '${stack}' (choose from ${knownStacks.join(', ')})\n`);
      return 2;
    }
  }

  const cwd = path.resolve(options.cwd);
  const ignorePath = path.join(cwd, '.gitignore');
  const existedBefore = fs.existsSync(ignorePath);

  let customGroup = null;
  try {
    customGroup = validateCustomRules(options.add, options.reason);
  } catch (error) {
    printJson({ ok: false, code: 'invalid_custom_rule', message: String(error.message ?? error) });
    return 2;
  }

  if (options.clean && (options.stacks.length > 0 || customGroup)) {
    printJson({
      ok: false,
      code: 'invalid_mode_combination',
      message: '--clean 不能与技术栈或 --add 同时使用',
    });
    return 2;
  }
  if (options.apply && !options.clean) {
    printJson({
      ok: false,
      code: 'invalid_mode_combination',
      message: '--apply 仅用于确认 --clean 的清理写入',
    });
    return 2;
  }

  const { lines, newline } = readIgnore(ignorePath);
  if (options.clean) {
    const { lines: cleanedLines, removals } = cleanDuplicateRules(lines);
    const changed = removals.length > 0 && options.apply && !options.dryRun;
    if (changed) writeIgnore(ignorePath, cleanedLines, newline);
    printJson({
      ok: true,
      mode: options.apply ? 'clean_apply' : 'clean_preview',
      path: ignorePath,
      changed,
      removals,
      next_step: options.apply ? null : '确认后使用 --clean --apply 执行清理',
    });
    return 0;
  }

  const detected = detectStacks(cwd);
  const selected = options.stacks.length > 0 ? options.stacks : detected;
  const groups = autoGroups(cwd, selected);
  if (customGroup) groups.push(customGroup);
  const { lines: updatedLines, addedGroups, skipped } = appendGroups(lines, groups);
  const changed = addedGroups.length > 0 && !options.dryRun;
  if (changed) writeIgnore(ignorePath, updatedLines, newline);
  printJson({
    ok: true,
    mode: options.dryRun ? 'preview' : 'apply',
    path: ignorePath,
    created: changed && !existedBefore,
    changed,
    detected_stacks: detected,
    selected_stacks: selected,
    added_groups: addedGroups,
    skipped_rules: skipped,
    env_handling: '未自动添加 .env；只有用户通过 --add 显式指定时才会写入。',
  });
  return 0;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    process.exitCode = 0;
  } else {
    process.exitCode = run(options);
  }
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n${USAGE}`);
  process.exitCode = 2;
}
