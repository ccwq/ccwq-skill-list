#!/usr/bin/env node
/**
 * Check paired agent-skill tags and body-only character limits.
 *
 * CLI 契约（与原 Python 版本一致）：
 *   node validate_prompt.mjs [path] [--limit N] [--total-limit N]
 *   - path 省略或为 "-" 时从 stdin 读取
 *   - 退出码：0 通过；1 校验不通过；2 读取失败或参数非法
 */

import fs from 'node:fs';

// 与 Python 的 re.DOTALL 等价：正文中允许出现换行。
const BLOCK = /<agent-skill:(?<name>[a-z0-9]+(?:-[a-z0-9]+)*)>(?<body>[\s\S]*?)<\/agent-skill:\k<name>>/g;
const TAG = /<\/?agent-skill:/;
// Python str.isspace() 覆盖的码点：ASCII 控制空白 + Unicode Zs 与行/段分隔符。
const SPACE_POINTS = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20,
  0x1c, 0x1d, 0x1e, 0x1f,
  0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
// Python unicodedata.category 属于 Cc / Cf / Cs 的字符。
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}]/u;

function isSpace(char) {
  return SPACE_POINTS.has(char.codePointAt(0));
}

/** 按码点统计非空白字符数，等价于 Python 的 sum(not char.isspace() for char in value)。 */
function countChars(value) {
  let count = 0;
  for (const char of value) {
    if (!isSpace(char)) count += 1;
  }
  return count;
}

function validate(value, limit = 700, totalLimit = null) {
  const errors = [];
  const blocks = [];
  let position = 0;

  BLOCK.lastIndex = 0;
  for (const match of value.matchAll(BLOCK)) {
    if (value.slice(position, match.index).trim()) {
      errors.push('标签块外含有文本或不匹配的标签。');
    }
    const name = match.groups.name;
    const body = match.groups.body;
    const bodyLength = countChars(body);
    const blockLength = countChars(match[0]);
    if (name.length > 64) errors.push(`${name}: 技能名超过64字符。`);
    if (!body.trim()) errors.push(`${name}: 正文为空。`);
    if (TAG.test(body)) errors.push(`${name}: 正文含有嵌套或残缺的 agent-skill 标签。`);
    if (bodyLength > limit) errors.push(`${name}: 正文${bodyLength}字，超过正文上限${limit}字。`);
    blocks.push({ name, body_chars: bodyLength, block_chars: blockLength });
    position = match.index + match[0].length;
  }
  if (value.slice(position).trim()) {
    errors.push('标签块外含有文本或不匹配的标签。');
  }
  if (blocks.length === 0) {
    errors.push('未找到合法的成对 agent-skill 标签块。');
  }
  // 与 Python 一致：空白字符本身不算不可见控制字符。
  for (const char of value) {
    if (INVISIBLE.test(char) && !isSpace(char)) {
      errors.push('含有不可见控制、格式或代理字符。');
      break;
    }
  }

  const totalBody = blocks.reduce((sum, block) => sum + block.body_chars, 0);
  const total = countChars(value);
  if (totalLimit !== null && totalBody > totalLimit) {
    errors.push(`正文合计${totalBody}字，超过正文合计上限${totalLimit}字。`);
  }
  return {
    ok: errors.length === 0,
    blocks,
    total_body_chars: totalBody,
    total_chars: total,
    errors,
  };
}

function positiveInt(value) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const result = Number(trimmed);
  return result > 0 ? result : null;
}

function usage() {
  return '用法：node validate_prompt.mjs [path] [--limit N] [--total-limit N]';
}

function parseArgs(argv) {
  const options = { path: null, limit: 700, totalLimit: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const raw = arg.startsWith('--limit=') ? arg.slice('--limit='.length) : argv[++index];
      if (raw === undefined) throw new Error('--limit 需要一个参数');
      const parsed = positiveInt(raw);
      if (parsed === null) throw new Error('上限必须为正整数。');
      options.limit = parsed;
    } else if (arg === '--total-limit' || arg.startsWith('--total-limit=')) {
      const raw = arg.startsWith('--total-limit=') ? arg.slice('--total-limit='.length) : argv[++index];
      if (raw === undefined) throw new Error('--total-limit 需要一个参数');
      const parsed = positiveInt(raw);
      if (parsed === null) throw new Error('上限必须为正整数。');
      options.totalLimit = parsed;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`未知参数：${arg}`);
    } else if (options.path === null) {
      options.path = arg;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }

  let value;
  try {
    value = options.path === null || options.path === '-'
      ? await readStdin()
      : fs.readFileSync(options.path, 'utf8');
  } catch (error) {
    console.log(JSON.stringify({ ok: false, errors: [String(error.message ?? error)] }));
    return 2;
  }

  const result = validate(value, options.limit, options.totalLimit);
  console.log(JSON.stringify(result));
  return result.ok ? 0 : 1;
}

process.exitCode = await main();
