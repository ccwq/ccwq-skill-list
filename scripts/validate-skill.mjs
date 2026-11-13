#!/usr/bin/env node
// validate-skill.mjs -- 按 docs/agent-skill规范.md 校验本仓库 skills/ 下的 Agent Skill
//
// 用法：
//   node scripts/validate-skill.mjs                # 校验全部 skill
//   node scripts/validate-skill.mjs git-up         # 只校验指定 skill
//   node scripts/validate-skill.mjs --strict       # 把警告也当作失败
//
// 退出码：0 = 全部通过；1 = 存在错误级问题；2 = 用法错误
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
// 默认以脚本所在位置（仓库 scripts/）的上一级为仓库根；可用 SKILL_LIST_ROOT 覆盖
const ROOT = process.env.SKILL_LIST_ROOT
  ? path.resolve(process.env.SKILL_LIST_ROOT)
  : path.resolve(SCRIPT_DIR, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const OFFICIAL_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const EXT_FIELDS = new Set(['argument-hint', 'disable-model-invocation', 'summary']);

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const targets = args.filter((a) => !a.startsWith('--'));

// ---------- 轻量 frontmatter 解析（避免引入 YAML 依赖） ----------
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return { error: '文件首行不是 ---' };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { error: '未找到结束的 --- 分隔符' };
  const fm = lines.slice(1, end);
  const top = {};
  const issues = [];
  let i = 0;
  while (i < fm.length) {
    const line = fm[i];
    if (!line.trim() || line.trim().startsWith('#')) { i += 1; continue; }
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (!m) { issues.push(`无法解析的行 ${i + 1}: ${line}`); i += 1; continue; }
    const key = m[1];
    const rest = m[2].trim();
    if (Object.prototype.hasOwnProperty.call(top, key)) issues.push(`重复的顶层键: ${key}`);
    if (['|', '|-', '>', '>-', '|+', '>+'].includes(rest)) {
      const buf = [];
      let j = i + 1;
      let indent = null;
      for (; j < fm.length; j += 1) {
        const l = fm[j];
        if (!l.trim()) { buf.push(''); continue; }
        const ind = l.match(/^\s*/)[0].length;
        if (ind === 0) break;
        if (indent === null) indent = ind;
        buf.push(l.slice(indent));
      }
      top[key] = { type: 'block', value: buf.join('\n').trimEnd(), quoted: false };
      i = j;
      continue;
    }
    if (rest === '') {
      const sub = {};
      const list = [];
      let j = i + 1;
      let isList = false;
      for (; j < fm.length; j += 1) {
        const l = fm[j];
        if (!l.trim()) continue;
        if (/^\s/.test(l) === false) break;
        const t = l.trim();
        if (t.startsWith('- ')) { isList = true; list.push(t.slice(2).trim()); continue; }
        const mm = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(t);
        if (mm) sub[mm[1]] = mm[2].trim();
        else issues.push(`嵌套结构无法解析: ${l}`);
      }
      top[key] = isList ? { type: 'list', value: list } : { type: 'map', value: sub };
      i = j;
      continue;
    }
    const quoted = /^["'].*["']$/.test(rest);
    top[key] = { type: 'scalar', value: quoted ? rest.slice(1, -1) : rest, quoted };
    i += 1;
  }
  return { top, issues };
}

// ---------- 单个 skill 校验 ----------
function validateSkill(dir) {
  const errors = [];
  const warnings = [];
  const file = path.join(SKILLS_DIR, dir, 'SKILL.md');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { errors: ['缺少 SKILL.md'], warnings }; }
  const parsed = parseFrontmatter(text);
  if (parsed.error) return { errors: [`frontmatter: ${parsed.error}`], warnings };
  parsed.issues.forEach((x) => errors.push(`frontmatter: ${x}`));
  const t = parsed.top;

  const name = t.name?.value ?? '';
  if (!name) errors.push('缺少 name');
  else {
    if (name.length > 64) errors.push(`name 超长 ${name.length} > 64`);
    if (!/^[a-z0-9-]+$/.test(name)) errors.push(`name 字符集非法: ${name}`);
    if (name.startsWith('-') || name.endsWith('-')) errors.push(`name 首尾连字符: ${name}`);
    if (name.includes('--')) errors.push(`name 含连续连字符: ${name}`);
    if (name !== dir) errors.push(`name(${name}) != 目录名(${dir})`);
  }

  const desc = t.description?.value ?? '';
  if (!desc) errors.push('缺少 description');
  else if (desc.length > 1024) errors.push(`description 超长 ${desc.length} > 1024`);

  for (const [k, v] of Object.entries(t)) {
    if (v.type === 'scalar' && !v.quoted && /:\s/.test(v.value)) {
      errors.push(`YAML 风险: ${k} 的值含未加引号的冒号`);
    }
  }

  if (t.metadata) {
    if (t.metadata.type !== 'map') errors.push(`metadata 应为映射，实际 ${t.metadata.type}`);
    else {
      for (const [k, v] of Object.entries(t.metadata.value)) {
        if (/^[[{]/.test(v)) errors.push(`metadata.${k} 是数组/对象，官方要求 string -> string`);
      }
    }
  }

  if (t.compatibility && t.compatibility.value.length > 500) {
    errors.push(`compatibility 超长 ${t.compatibility.value.length} > 500`);
  }

  for (const k of Object.keys(t)) {
    if (!OFFICIAL_FIELDS.has(k) && !EXT_FIELDS.has(k)) {
      warnings.push(`非官方且非白名单字段: ${k}`);
    }
  }
  if (t.version) warnings.push('顶层 version 为遗留写法，应写在 metadata.version');

  const lines = text.split(/\r?\n/).length;
  if (lines > 500) warnings.push(`SKILL.md ${lines} 行，超过建议上限 500 行`);

  // eval 用例
  const evalFile = path.join(SKILLS_DIR, dir, 'evals', 'trigger-queries.json');
  if (fs.existsSync(evalFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(evalFile, 'utf8'));
      if (!Array.isArray(data)) warnings.push('evals/trigger-queries.json 顶层不是数组');
      else {
        const pos = data.filter((x) => x.should_trigger === true).length;
        const neg = data.filter((x) => x.should_trigger === false).length;
        if (pos === 0 || neg === 0) warnings.push(`触发用例缺少正例或负例 (正 ${pos} / 负 ${neg})`);
      }
    } catch (e) {
      errors.push(`evals/trigger-queries.json 不是合法 JSON: ${e.message}`);
    }
  }

  return { errors, warnings };
}

// ---------- 仓库同步校验 ----------
function validateSync(dirs) {
  const errors = [];
  const warnings = [];
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const marketBySource = new Map(market.plugins.map((p) => [p.source.replace(/^\.\//, ''), p]));
  for (const dir of dirs) {
    if (!readme.includes(`\`${dir}\``)) errors.push(`根 README 索引缺少 ${dir}`);
    const entry = marketBySource.get(`skills/${dir}`);
    if (!entry) errors.push(`marketplace.json 缺少 skills/${dir} 条目`);
    else if (entry.name !== dir) errors.push(`marketplace 条目名 ${entry.name} != 目录名 ${dir}`);
  }
  for (const p of market.plugins) {
    if (p.source === '.' || p.source === './') continue;
    const dir = p.source.replace(/^\.\//, '');
    if (!fs.existsSync(path.join(ROOT, dir))) warnings.push(`marketplace 条目 ${p.name} 的 source 不存在: ${p.source}`);
  }
  return { errors, warnings };
}

// ---------- 主流程 ----------
if (!fs.existsSync(SKILLS_DIR)) {
  console.error(`找不到 skills 目录: ${SKILLS_DIR}`);
  process.exit(2);
}
const allDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const skillDirs = targets.length ? targets.filter((d) => allDirs.includes(d)) : allDirs.filter((d) => fs.existsSync(path.join(SKILLS_DIR, d, 'SKILL.md')));
if (targets.length && skillDirs.length !== targets.length) {
  const missing = targets.filter((d) => !allDirs.includes(d));
  console.error(`未找到 skill 目录: ${missing.join(', ')}`);
  process.exit(2);
}

let errorCount = 0;
let warnCount = 0;
for (const dir of skillDirs) {
  const { errors, warnings } = validateSkill(dir);
  errorCount += errors.length;
  warnCount += warnings.length;
  const status = errors.length ? 'FAIL' : (warnings.length ? 'WARN' : 'OK  ');
  console.log(`${status} ${dir}`);
  errors.forEach((e) => console.log(`       错误: ${e}`));
  warnings.forEach((w) => console.log(`       警告: ${w}`));
}

if (!targets.length) {
  const sync = validateSync(skillDirs);
  errorCount += sync.errors.length;
  warnCount += sync.warnings.length;
  console.log('--- 仓库同步 ---');
  sync.errors.forEach((e) => console.log(`       错误: ${e}`));
  sync.warnings.forEach((w) => console.log(`       警告: ${w}`));
}

console.log(`\n共 ${skillDirs.length} 个 skill，${errorCount} 个错误，${warnCount} 个警告`);
process.exit(errorCount > 0 || (strict && warnCount > 0) ? 1 : 0);
