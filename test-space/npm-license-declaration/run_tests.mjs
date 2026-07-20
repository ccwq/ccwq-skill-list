import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const generatorPath = path.join(repositoryRoot, 'skills', 'npm-license-declaration', 'scripts', 'generate-license-declaration.mjs');

/**
 * Given：临时项目同时具有 dependencies、devDependencies 和一个 npm 不可公开查询的私有包，lock 文件为私有包提供 resolved。
 * When：执行许可证声明生成器。
 * Then：文档覆盖所有去重后的直接依赖，公开包使用 npm latest 元数据，私有包落入不可用分组并保留 resolved URL。
 * 防回归：避免生成器遗漏 devDependencies、重复同名包或在 Registry 查询失败时丢失 lock 兜底地址。
 */
async function testDeclarationGeneration() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'npm-license-declaration-'));
  const privateName = '@ccwq-test/private-package-that-does-not-exist';

  try {
    await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
      dependencies: {
        'is-number': '^7.0.0',
        [privateName]: '^1.0.0',
      },
      devDependencies: {
        kleur: '^4.1.5',
        'is-number': '^7.0.0',
      },
    }, null, 2));
    await writeFile(path.join(projectRoot, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        [`node_modules/${privateName}`]: {
          resolved: 'https://packages.example.test/private-package-1.0.0.tgz',
        },
      },
    }, null, 2));

    await execFileAsync(process.execPath, [generatorPath, '--project', projectRoot]);
    const report = await readFile(path.join(projectRoot, 'docs', 'npm-license-declaration.md'), 'utf8');

    assert.match(report, /^# 第三方依赖许可证声明/m);
    assert.match(report, /^## 依赖列表$/m);
    assert.match(report, /^## 不可用依赖$/m);
    const listedNames = [...report.matchAll(/^## ([^\s]+) v[^\r\n]+$/gm)].map((match) => match[1]).sort();
    assert.deepEqual(listedNames, [privateName, 'is-number', 'kleur'].sort());
    assert.match(report, /MIT License（MIT）/);
    assert.match(report, /GitHub：https:\/\/packages\.example\.test\/private-package-1\.0\.0\.tgz/);
    assert.match(report, /- @ccwq-test\/private-package-that-does-not-exist v未知：建议手动核实。/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

await testDeclarationGeneration();
console.log('npm-license-declaration integration test passed');
