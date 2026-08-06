#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const MANIFEST_RELATIVE_PATH = path.join('.claude-plugin', 'plugin.json');
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function usage() {
  return `用法：node scripts/sync-main-skill-manifest.mjs [--check] [--root <仓库路径>]\n\n读取 <root>/.env 的 MAIN_LIST，生成 <root>/.claude-plugin/plugin.json。\n--check 仅校验生成文件是否与清单一致，不写文件。`;
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`找不到 .env：${filePath}`);

  const entries = new Map();
  for (const [index, line] of fs.readFileSync(filePath, 'utf8').split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) throw new Error(`.env 第 ${index + 1} 行不是 KEY=value 格式`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.set(match[1], value);
  }
  return entries;
}

function mainSkills(root) {
  const value = readDotEnv(path.join(root, '.env')).get('MAIN_LIST');
  if (!value) throw new Error('MAIN_LIST 不能为空；示例：MAIN_LIST=git-up,subagent-router');

  const seen = new Set();
  return value.split(',').map((item) => item.trim()).map((name) => {
    if (!SKILL_NAME_PATTERN.test(name)) throw new Error(`MAIN_LIST 包含非法 Skill 名：${name || '(空值)'}`);
    if (seen.has(name)) throw new Error(`MAIN_LIST 包含重复 Skill：${name}`);
    seen.add(name);

    const skillFile = path.join(root, 'skills', name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) throw new Error(`MAIN_LIST 指向的 Skill 不存在或缺少 SKILL.md：skills/${name}/SKILL.md`);
    return `./skills/${name}`;
  });
}

function expectedManifest(root) {
  return {
    name: 'ccwq-skill-list',
    version: '1.0.0',
    description: 'ccwq 的主要 Claude Code Skill 集合；未显式列出的 Skill 由 skills CLI 归入 Other。',
    skills: mainSkills(root),
  };
}

function parseArgs(args) {
  const result = { check: false, root: process.cwd() };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--check') result.check = true;
    else if (args[index] === '--root') {
      result.root = args[index + 1];
      if (!result.root) throw new Error('--root 需要一个路径');
      index += 1;
    } else if (args[index] === '--help' || args[index] === '-h') {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`未知参数：${args[index]}`);
  }
  return result;
}

function sameManifest(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root);
  const manifest = expectedManifest(root);
  const manifestPath = path.join(root, MANIFEST_RELATIVE_PATH);

  if (options.check) {
    if (!fs.existsSync(manifestPath)) throw new Error(`主 Skill manifest 尚未生成：${MANIFEST_RELATIVE_PATH}`);
    let actual;
    try { actual = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch { throw new Error(`主 Skill manifest 不是合法 JSON：${MANIFEST_RELATIVE_PATH}`); }
    if (!sameManifest(actual, manifest)) throw new Error(`主 Skill manifest 与 MAIN_LIST 不同步；运行 node scripts/sync-main-skill-manifest.mjs`);
    console.log('MAIN_SKILL_MANIFEST_VALID');
    return;
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`MAIN_SKILL_MANIFEST_UPDATED ${MANIFEST_RELATIVE_PATH}`);
}

try { run(); }
catch (error) {
  console.error(`[sync-main-skill-manifest] ${error.message}`);
  process.exitCode = 1;
}
