import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(repositoryRoot, 'scripts', 'package-skills.mjs');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'package-skills-'));

try {
  fs.mkdirSync(path.join(fixtureRoot, 'skills', 'demo-skill', 'references'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'skills', 'ignored-directory'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'skill-zips'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'skills', 'demo-skill', 'SKILL.md'), '# Demo\n', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'skills', 'demo-skill', 'references', 'guide.md'), 'guide\n', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'skill-zips', 'stale.zip'), 'keep me', 'utf8');

  const result = spawnSync(process.execPath, [script, '--root', fixtureRoot], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  const archive = path.join(fixtureRoot, 'skill-zips', 'demo-skill.zip');
  assert.equal(fs.existsSync(archive), true);
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'skill-zips', 'stale.zip')), true);

  const expandedDirectory = path.join(fixtureRoot, 'expanded');
  const listing = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$ErrorActionPreference = 'Stop'; `
    + `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${expandedDirectory.replaceAll("'", "''")}' -Force; `
    // 相对路径在 PowerShell 内部计算。Node 的 os.tmpdir() 返回 8.3 短路径，
    // PowerShell 枚举出的文件路径是长路径，两侧长度不一致会让外部截取错位。
    // Get-Item 的 FullName 与 Get-ChildItem 的 FullName 都是长路径。
    + `$base = (Get-Item -LiteralPath '${expandedDirectory.replaceAll("'", "''")}').FullName; `
    + `Get-ChildItem -LiteralPath $base -Recurse -File | ForEach-Object { $_.FullName.Substring($base.Length + 1) }`,
  ], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.deepEqual(
    listing.stdout.trim().split(/\r?\n/).map((item) => item.trim()).sort(),
    ['SKILL.md', path.join('references', 'guide.md')].sort(),
  );

  console.log('PACKAGE_SKILLS_TESTS_PASSED');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
