#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { writeZip } from './zip.mjs';

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function usage() {
  return `用法：node scripts/package-skills.mjs [--skill <名称>] [--root <仓库路径>]

将 skills/ 下的 Skill 分别打包到 skill-zips/<名称>.zip。
--skill 只打包指定 Skill；不传时打包全部 Skill。
--root 指定仓库根目录，默认使用当前目录。`;
}

function parseArgs(args) {
  const options = { root: process.cwd(), skill: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--root') {
      options.root = args[index + 1];
      if (!options.root) throw new Error('--root 需要一个路径');
      index += 1;
    } else if (arg === '--skill') {
      options.skill = args[index + 1];
      if (!options.skill) throw new Error('--skill 需要一个 Skill 名称');
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

function discoverSkills(root, selectedSkill) {
  const skillsRoot = path.join(root, 'skills');
  if (!fs.existsSync(skillsRoot)) throw new Error(`找不到 skills 目录：${skillsRoot}`);

  const candidates = selectedSkill
    ? [selectedSkill]
    : fs.readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

  const skills = [];
  for (const name of candidates) {
    if (!SKILL_NAME_PATTERN.test(name)) {
      if (selectedSkill) throw new Error(`非法 Skill 名称：${name}`);
      continue;
    }
    const directory = path.join(skillsRoot, name);
    const skillFile = path.join(directory, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      if (selectedSkill) throw new Error(`Skill 不存在或缺少 SKILL.md：skills/${name}/SKILL.md`);
      continue;
    }
    skills.push({ name, directory });
  }
  if (skills.length === 0) throw new Error('没有发现可打包的 Skill');
  return skills;
}

function zipSkill(skill, outputDirectory) {
  const destination = path.join(outputDirectory, `${skill.name}.zip`);
  // 用 Node 自带的 ZIP 写入器，条目名一律用正斜杠。
  // .NET 的 ZipFile.CreateFromDirectory 在 Windows 上写反斜杠路径，Linux 与 macOS 解包会失败。
  const result = writeZip(skill.directory, destination);
  return { destination, ...result };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root);
  const outputDirectory = path.join(root, 'skill-zips');
  fs.mkdirSync(outputDirectory, { recursive: true });

  const skills = discoverSkills(root, options.skill);
  for (const skill of skills) {
    const { destination, entries } = zipSkill(skill, outputDirectory);
    console.log(`已打包 ${skill.name} -> ${path.relative(root, destination)}（${entries} 个条目）`);
  }
  console.log(`SKILL_ZIP_PACKAGE_COMPLETE ${skills.length}`);
}

try {
  run();
} catch (error) {
  console.error(`[package-skills] ${error.message}`);
  process.exitCode = 1;
}
