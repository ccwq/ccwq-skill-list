#!/usr/bin/env node
/**
 * my-prompts.md 全量校验器。
 *
 * 检查项：
 *   1. 三分区标签序列分别等于对应 .env 清单
 *      （MY_PROMPTS_LIST / MY_PROMPTS_TOOLS_LIST / MY_PROMPTS_THIRD_PARTY_LIST）
 *   2. MY_PROMPTS_THIRD_PARTY_PENDING 项不得出现在标签块中
 *   3. 无重复、无残缺或嵌套标签
 *   4. 本仓库条目来源链接存在
 *   5. 「未收录」表完整覆盖（正式 skills − 普通聊天＋工具型并集）
 *   6. 每块正文 ≤720 字（调用 skill-to-prompt 的 validate_prompt.mjs --limit 720）
 *   7. 无不可见控制字符
 *
 * CLI 契约：
 *   node validate.mjs                # 校验仓库根 my-prompts.md，输出 JSON 报告
 *   退出码：0 通过；1 校验不通过
 *
 * 运行前提：必须在仓库根目录运行；
 * 依赖 skills/skill-to-prompt/scripts/validate_prompt.mjs。
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const DOC = path.join(root, 'my-prompts.md');
const ENV = path.join(root, '.env');
const VALIDATOR = path.join(root, 'skills', 'skill-to-prompt', 'scripts', 'validate_prompt.mjs');

// 与 my-prompts.md 的分区标题精确对应（顺序固定）
const SECTIONS = [
  { env: 'MY_PROMPTS_LIST', start: '## 本仓库普通聊天提示词', end: '## 本仓库工具型提示词' },
  { env: 'MY_PROMPTS_TOOLS_LIST', start: '## 本仓库工具型提示词', end: '## 第三方提示词' },
  { env: 'MY_PROMPTS_THIRD_PARTY_LIST', start: '## 第三方提示词', end: '## 第三方待补全' },
];

const errors = [];

function fail(msg) {
  errors.push(msg);
}

/** .env 清单值解析：合并续行反斜杠，按逗号拆分。 */
function parseEnvList(raw) {
  return raw.replace(/\\\r?\n/g, '').split(',').map(s => s.trim()).filter(Boolean);
}

// ---- .env 清单 ----
// .env 续行：值尾反斜杠续接下一行；先全文合并再匹配，否则 match[1] 只到行尾。
const envRaw = fs.readFileSync(ENV, 'utf8').replace(/\\\r?\n/g, '');
const envLists = {};
for (const { env } of SECTIONS) {
  const match = envRaw.match(new RegExp(`^${env}=(.*)$`, 'm'));
  if (!match) fail(`.env 缺少 ${env}`);
  envLists[env] = match ? parseEnvList(match[1]) : [];
}
const pendingMatch = envRaw.match(/^MY_PROMPTS_THIRD_PARTY_PENDING=(.*)$/m);
const pending = pendingMatch ? parseEnvList(pendingMatch[1]) : [];

// 跨清单重复检查
const allSelectedLists = SECTIONS.map(({ env }) => envLists[env]);
const allSelected = allSelectedLists.flat();
const seen = new Set();
for (const list of allSelectedLists) {
  for (const name of list) {
    if (seen.has(name)) fail(`跨清单重复收录：${name}`);
    seen.add(name);
  }
}

// ---- 正式维护范围：skills/ 下的 SKILL.md 目录 ----
const maintained = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
  .filter(e => e.isDirectory() && fs.existsSync(path.join(root, 'skills', e.name, 'SKILL.md')))
  .map(e => e.name);

// ---- 文档分区定位 ----
const document = fs.readFileSync(DOC, 'utf8');
for (const { start, env } of SECTIONS) {
  if (!document.includes(start)) fail(`文档缺少分区标题「${start}」（${env}）`);
}
function sectionBetween(startHeading, endHeading) {
  const start = document.indexOf(startHeading);
  if (start === -1) return '';
  const end = document.indexOf(endHeading, start + startHeading.length);
  return document.slice(start, end === -1 ? undefined : end);
}
const chatSection = sectionBetween(SECTIONS[0].start, SECTIONS[0].end);
const toolsSection = sectionBetween(SECTIONS[1].start, SECTIONS[1].end);
const thirdSection = sectionBetween(SECTIONS[2].start, SECTIONS[2].end);

// ---- 标签块 ----
const BLOCK = /<agent-skill:(?<name>[a-z0-9]+(?:-[a-z0-9]+)*)>(?<body>[\s\S]*?)<\/agent-skill:\k<name>>/g;
const seq = (text) => [...text.matchAll(BLOCK)].map(m => m.groups.name);
const chatSeq = seq(chatSection);
const toolsSeq = seq(toolsSection);
const thirdSeq = seq(thirdSection);
const names = seq(document);

// ---- 检查 1：分区序列 == .env 清单 ----
if (chatSeq.join(',') !== envLists.MY_PROMPTS_LIST.join(',')) {
  fail(`普通聊天分区标签序列与 MY_PROMPTS_LIST 不一致：文档 [${chatSeq.join(',')}] vs .env [${envLists.MY_PROMPTS_LIST.join(',')}]`);
}
if (toolsSeq.join(',') !== envLists.MY_PROMPTS_TOOLS_LIST.join(',')) {
  fail(`工具型分区标签序列与 MY_PROMPTS_TOOLS_LIST 不一致：文档 [${toolsSeq.join(',')}] vs .env [${envLists.MY_PROMPTS_TOOLS_LIST.join(',')}]`);
}
if (thirdSeq.join(',') !== envLists.MY_PROMPTS_THIRD_PARTY_LIST.join(',')) {
  fail(`第三方分区标签序列与 MY_PROMPTS_THIRD_PARTY_LIST 不一致：文档 [${thirdSeq.join(',')}] vs .env [${envLists.MY_PROMPTS_THIRD_PARTY_LIST.join(',')}]`);
}

// ---- 检查 2：PENDING 项不得有标签块 ----
for (const name of pending) {
  if (names.includes(name)) fail(`PENDING 项 ${name} 不得有标签块`);
}

// ---- 检查 3：全文档无重复标签 ----
const dupCheck = new Set();
for (const name of names) {
  if (dupCheck.has(name)) fail(`标签块重复：${name}`);
  dupCheck.add(name);
}

// ---- 检查 4：本仓库条目来源链接与技能源存在 ----
for (const name of [...envLists.MY_PROMPTS_LIST, ...envLists.MY_PROMPTS_TOOLS_LIST]) {
  const src = path.join(root, 'skills', name, 'SKILL.md');
  if (!fs.existsSync(src)) fail(`收录的本仓库条目缺技能源：${name}`);
  if (!document.includes(`](skills/${name}/SKILL.md)`)) fail(`缺少来源链接：${name}`);
}

// ---- 检查 5：未收录表覆盖（正式 skills − 普通聊天＋工具型并集） ----
const excludedSection = document.split('## 未收录')[1];
if (!excludedSection) {
  fail('缺少「## 未收录」节');
} else {
  const excluded = [...excludedSection.matchAll(/^\| `([^`]+)` \|/gm)].map(m => m[1]);
  const expectedExcluded = maintained.filter(n => !allSelected.includes(n)).sort();
  if (excluded.length !== new Set(excluded).size) fail('「未收录」表有重复');
  if (JSON.stringify(excluded.slice().sort()) !== JSON.stringify(expectedExcluded)) {
    fail(`「未收录」表与预期不一致：文档 [${excluded.slice().sort().join(',')}] vs 预期 [${expectedExcluded.join(',')}]`);
  }
}

// ---- 检查 6：格式与字数 —— 提取全部标签块，交原校验器 ----
const result = spawnSync(process.execPath, [VALIDATOR, '--limit', '720'], {
  input: [...document.matchAll(BLOCK)].map(m => m[0]).join('\n\n'),
  encoding: 'utf8',
});
if (result.error) fail(`原校验器执行失败：${result.error}`);
let report = null;
if (!result.error && result.status !== undefined) {
  try {
    report = JSON.parse(result.stdout);
  } catch {
    fail(`原校验器输出不是合法 JSON：${(result.stdout || '').slice(0, 100)}`);
  }
  if (report && !report.ok) fail(`格式或字数不合格：${(report.errors || []).join('；')}`);
}

// ---- 检查 7：整份文档无不可见控制字符（原校验器只查传入部分） ----
for (const char of document) {
  const code = char.codePointAt(0);
  const isCommonWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
  if (!isCommonWhitespace && /\p{Cc}|\p{Cf}|\p{Cs}/u.test(char)) {
    fail(`文档含不可见控制字符（U+${code.toString(16).toUpperCase().padStart(4, '0')}）`);
    break;
  }
}

// ---- 输出 ----
console.log(JSON.stringify({
  ok: errors.length === 0,
  maintained_skills: maintained.length,
  selected_chat: envLists.MY_PROMPTS_LIST.length,
  selected_tools: envLists.MY_PROMPTS_TOOLS_LIST.length,
  selected_third_party: envLists.MY_PROMPTS_THIRD_PARTY_LIST.length,
  pending: pending.length,
  excluded: excludedSection ? [...excludedSection.matchAll(/^\| `([^`]+)` \|/gm)].length : 0,
  blocks: report ? report.blocks : [],
  max_body_chars: report && report.blocks.length ? Math.max(...report.blocks.map(b => b.body_chars)) : 0,
  total_body_chars: report ? report.total_body_chars : 0,
  errors,
}, null, 2));

process.exitCode = errors.length === 0 ? 0 : 1;
