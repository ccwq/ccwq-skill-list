import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readZipEntries, readZipFile } from '../../scripts/zip.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(repositoryRoot, 'scripts', 'package-skills.mjs');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'package-skills-'));

try {
  fs.mkdirSync(path.join(fixtureRoot, 'skills', 'demo-skill', 'references'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'skills', 'demo-skill', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'skills', 'ignored-directory'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'skill-zips'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'skills', 'demo-skill', 'SKILL.md'), '# Demo\n', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'skills', 'demo-skill', 'references', 'guide.md'), 'guide\n', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'skills', 'demo-skill', 'scripts', 'run.mjs'), 'export const x = 1;\n', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, 'skill-zips', 'stale.zip'), 'keep me', 'utf8');

  const result = spawnSync(process.execPath, [script, '--root', fixtureRoot], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  const archive = path.join(fixtureRoot, 'skill-zips', 'demo-skill.zip');
  assert.equal(fs.existsSync(archive), true);
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'skill-zips', 'stale.zip')), true);

  // 条目名必须是 POSIX 正斜杠路径。
  // 防回归：.NET 的 ZipFile.CreateFromDirectory 在 Windows 上写反斜杠路径，
  //         按 POSIX 路径匹配的解压器在 Linux 与 macOS 上找不到这些条目。
  const entries = readZipEntries(archive);
  assert.deepEqual(
    entries.filter((name) => name.endsWith('/')).length,
    0,
    '不应产生目录条目',
  );
  for (const name of entries) {
    assert.equal(name.includes('\\'), false, `条目名不得含反斜杠：${name}`);
  }
  assert.deepEqual(
    entries.slice().sort(),
    ['SKILL.md', 'references/guide.md', 'scripts/run.mjs'],
    '条目名须为 POSIX 相对路径',
  );

  // 内容须与源文件逐字节一致。
  assert.equal(
    readZipFile(archive, 'SKILL.md').toString('utf8'),
    '# Demo\n',
  );
  assert.equal(
    readZipFile(archive, 'references/guide.md').toString('utf8'),
    'guide\n',
  );
  assert.equal(
    readZipFile(archive, 'scripts/run.mjs').toString('utf8'),
    'export const x = 1;\n',
  );

  // 有子目录的 skill 必须能被按 POSIX 路径解包。
  const expandedDirectory = path.join(fixtureRoot, 'expanded');
  fs.mkdirSync(expandedDirectory, { recursive: true });
  const extracted = spawnSync('unzip', ['-o', '-q', archive, '-d', expandedDirectory], {
    encoding: 'utf8',
  });
  if (extracted.error) {
    // 没有 unzip 时跳过解包检查，条目名与内容断言已覆盖核心契约。
    console.log('PACKAGE_SKILLS_TESTS_PASSED（跳过 unzip 解包检查）');
  } else {
    assert.equal(extracted.status, 0, extracted.stderr);
    assert.equal(
      fs.existsSync(path.join(expandedDirectory, 'references', 'guide.md')),
      true,
      '解包后应按 POSIX 路径生成子目录',
    );
    assert.equal(
      fs.readFileSync(path.join(expandedDirectory, 'references', 'guide.md'), 'utf8'),
      'guide\n',
    );
    console.log('PACKAGE_SKILLS_TESTS_PASSED');
  }
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
