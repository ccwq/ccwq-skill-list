#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

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
  // 使用 .NET ZipFile 可保留隐藏文件，并让 zip 内直接以 Skill 内容为根。
  const command = [
    '$ErrorActionPreference = "Stop"',
    '$source = $env:SKILL_PACKAGE_SOURCE',
    '$destination = $env:SKILL_PACKAGE_DESTINATION',
    'if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '[System.IO.Compression.ZipFile]::CreateFromDirectory($source, $destination, [System.IO.Compression.CompressionLevel]::Optimal, $false)',
  ].join('; ');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ], {
    env: {
      ...process.env,
      SKILL_PACKAGE_SOURCE: skill.directory,
      SKILL_PACKAGE_DESTINATION: destination,
    },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`打包 ${skill.name} 失败：${(result.stderr || result.stdout || '').trim()}`);
  }
  return destination;
}

function run() {
  if (process.platform !== 'win32') {
    throw new Error('当前打包实现依赖 Windows PowerShell，仅支持 Windows。');
  }
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root);
  const outputDirectory = path.join(root, 'skill-zips');
  fs.mkdirSync(outputDirectory, { recursive: true });

  const skills = discoverSkills(root, options.skill);
  for (const skill of skills) {
    const destination = zipSkill(skill, outputDirectory);
    console.log(`已打包 ${skill.name} -> ${path.relative(root, destination)}`);
  }
  console.log(`SKILL_ZIP_PACKAGE_COMPLETE ${skills.length}`);
}

try {
  run();
} catch (error) {
  console.error(`[package-skills] ${error.message}`);
  process.exitCode = 1;
}
