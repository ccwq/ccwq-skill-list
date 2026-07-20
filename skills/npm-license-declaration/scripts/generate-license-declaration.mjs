#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const registry = 'https://registry.npmjs.org';
const outputRelativePath = path.join('docs', 'npm-license-declaration.md');
const retryableStatus = new Set([408, 425, 429, 500, 502, 503, 504]);
const rulesPath = fileURLToPath(new URL('../references/license-rules.json', import.meta.url));
const licensePolicy = JSON.parse(await readFile(rulesPath, 'utf8'));
const unavailableRule = {
  grade: licensePolicy.unavailable.grade,
  fullName: '未知',
  recommendation: licensePolicy.unavailable.recommendation,
};
const licenseRules = Object.fromEntries(licensePolicy.groups.flatMap((group) =>
  Object.entries(group.licenses).map(([spdx, fullName]) => [spdx, {
    grade: group.grade,
    fullName,
    recommendation: group.recommendation,
  }]),
));
const gradeOrder = [...licensePolicy.groups.map(({ grade }) => grade), licensePolicy.unavailable.grade];

function parseArguments(argv) {
  if (argv.length === 0) return process.cwd();
  if (argv.length === 2 && argv[0] === '--project') return path.resolve(argv[1]);
  throw new Error('用法：node generate-license-declaration.mjs [--project <项目根目录>]');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchLatest(packageName) {
  const url = `${registry}/${encodeURIComponent(packageName)}/latest`;
  let lastError;

  for (let round = 0; round < 2; round += 1) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, { headers: { accept: 'application/json' } });
        if (response.ok) return response.json();
        if (!retryableStatus.has(response.status)) throw new Error(`Registry 返回 HTTP ${response.status}`);
        lastError = new Error(`Registry 返回可重试 HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
        if (/^Registry 返回 HTTP /.test(error.message)) throw error;
      }

      if (attempt === 0) await sleep(10_000);
    }
    if (round === 0) await sleep(25_000);
  }

  throw lastError ?? new Error('Registry 查询失败');
}

function repositoryUrl(repository) {
  const value = typeof repository === 'string' ? repository : repository?.url;
  if (typeof value !== 'string' || value.trim() === '') return '未找到';
  return value.trim().replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
}

function normalizeText(value, fallback = '未找到') {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  return value.replace(/\s+/g, ' ').trim();
}

function classifyLicense(license) {
  if (typeof license !== 'string' || license.trim() === '') return { spdx: '未知', ...unavailableRule };
  const spdx = license.trim();
  return { spdx, ...(licenseRules[spdx] ?? unavailableRule) };
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolvedFromPackageLock(lock, packageName) {
  if (!lock) return null;
  const packageEntry = lock.packages?.[`node_modules/${packageName}`];
  if (typeof packageEntry?.resolved === 'string') return packageEntry.resolved;
  const directDependency = lock.dependencies?.[packageName];
  return typeof directDependency?.resolved === 'string' ? directDependency.resolved : null;
}

async function resolvedFromYarnLock(filePath, packageName) {
  try {
    const text = await readFile(filePath, 'utf8');
    const blocks = text.split(/\r?\n\r?\n/);
    const matchingBlock = blocks.find((block) => block.split(/\r?\n/, 1)[0]?.includes(`${packageName}@`));
    return matchingBlock?.match(/^\s*resolved\s+"([^"]+)"/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function lockResolvedUrl(projectRoot, packageName, packageLock) {
  return resolvedFromPackageLock(packageLock, packageName)
    ?? await resolvedFromYarnLock(path.join(projectRoot, 'yarn.lock'), packageName)
    ?? '未找到';
}

function renderMarkdown(entries) {
  const unavailableEntries = entries.filter((entry) => entry.grade === licensePolicy.unavailable.grade);
  const counts = Object.fromEntries(gradeOrder.map((grade) => [grade, 0]));
  for (const entry of entries) counts[entry.grade] += 1;

  const summaryRows = [...licensePolicy.groups, licensePolicy.unavailable]
    .map((group) => `| ${group.grade} | ${group.representativeLicenses} | ${group.meaning} | ${group.summaryRecommendation} |`)
    .join('\n');
  const entryBlocks = entries.map((entry) => `## ${entry.name} v${entry.version}\n\n- 功能：${entry.description}\n- GitHub：${entry.github}\n- 许可证：${entry.fullName}（${entry.spdx}）\n- 分级：${entry.grade}\n- 建议：${entry.recommendation}`).join('\n\n');
  const unavailableBlocks = unavailableEntries.length === 0
    ? '无。'
    : unavailableEntries.map((entry) => `- ${entry.name} v${entry.version}：${licensePolicy.unavailable.recommendation}。`).join('\n');
  const statistics = gradeOrder.map((grade) => `- ${grade}：${counts[grade]}`).join('\n');

  return `# 第三方依赖许可证声明\n\n本文档自动生成，列出项目中各直接依赖的许可证类型及相应建议。包元数据统一查询 npm Registry 的 latest 版本。\n\n## 分级说明\n\n| 分级 | 代表许可证 | 含义 | 建议操作 |\n| --- | --- | --- | --- |\n${summaryRows}\n\n## 依赖列表\n\n${entryBlocks || '未发现 dependencies 或 devDependencies。'}\n\n## 不可用依赖\n\n${unavailableBlocks}\n\n## 统计\n\n${statistics}\n`;
}

function listedPackageNames(markdown) {
  return [...markdown.matchAll(/^## ([^\s]+) v[^\r\n]+$/gm)].map((match) => match[1]);
}

async function verifyGeneratedReport(outputPath, expectedPackageNames) {
  const markdown = await readFile(outputPath, 'utf8');
  for (const heading of ['# 第三方依赖许可证声明', '## 依赖列表', '## 不可用依赖']) {
    if (!markdown.includes(heading)) throw new Error(`生成文档缺少章节：${heading}`);
  }

  const listedNames = listedPackageNames(markdown);
  const expected = new Set(expectedPackageNames);
  const exactMatch = listedNames.length === expected.size
    && listedNames.every((name) => expected.has(name));
  if (!exactMatch) throw new Error('生成文档的依赖名称集合与 package.json 不一致');
}

async function main() {
  const projectRoot = parseArguments(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const packageNames = [...new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ])].sort((left, right) => left.localeCompare(right, 'en'));
  const packageLock = await readJsonIfPresent(path.join(projectRoot, 'package-lock.json'));

  const entries = [];
  for (const name of packageNames) {
    try {
      const metadata = await fetchLatest(name);
      entries.push({
        name,
        version: normalizeText(metadata.version, '未知'),
        description: normalizeText(metadata.description),
        github: repositoryUrl(metadata.repository),
        ...classifyLicense(metadata.license),
      });
    } catch (error) {
      entries.push({
        name,
        version: '未知',
        description: '未找到',
        github: await lockResolvedUrl(projectRoot, name, packageLock),
        ...classifyLicense(null),
      });
      console.warn(`[npm-license-declaration] ${name}：${error.message}`);
    }
  }

  const outputPath = path.join(projectRoot, outputRelativePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderMarkdown(entries), 'utf8');
  await verifyGeneratedReport(outputPath, packageNames);

  const count = (grade) => entries.filter((entry) => entry.grade === grade).length;
  console.log(`已生成 ${outputPath}`);
  console.log(`依赖 ${entries.length} 个：${gradeOrder.map((grade) => `${grade} ${count(grade)}`).join('，')}。`);
}

main().catch((error) => {
  console.error(`[npm-license-declaration] ${error.message}`);
  process.exitCode = 1;
});
