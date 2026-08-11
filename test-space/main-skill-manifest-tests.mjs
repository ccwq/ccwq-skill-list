import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'scripts', 'sync-main-skill-manifest.mjs');

function fixture(mainList, skills = ['git-up', 'subagent-router'], envContent = `MAIN_LIST=${mainList}\n`) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'main-skill-manifest-'));
  fs.writeFileSync(path.join(root, '.env'), envContent);
  for (const name of skills) {
    const directory = path.join(root, 'skills', name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'SKILL.md'), `# ${name}\n`);
  }
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' });
}

function remove(root) { fs.rmSync(root, { recursive: true, force: true }); }

/**
 * Given：MAIN_LIST 指向两个存在且合法的 Skill
 * When：运行同步脚本
 * Then：生成带显式 skills 路径的 plugin manifest
 * 防回归：防止主分组重新依赖目录名或 marketplace 的非标准 source
 */
{
  const root = fixture('git-up,subagent-router');
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).skills, ['./skills/git-up', './skills/subagent-router']);
  } finally { remove(root); }
}

/**
 * Given: MAIN_LIST spans multiple physical lines using a trailing backslash
 * When: the sync script runs
 * Then: it generates the expected skills manifest after joining the continuation
 * Regression: a continued .env value must not be parsed as an invalid KEY=value line
 */
{
  const root = fixture('ignored', ['git-up', 'subagent-router'], 'MAIN_LIST=git-up,\\\nsubagent-router\n');
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).skills, ['./skills/git-up', './skills/subagent-router']);
  } finally { remove(root); }
}

/**
 * Given: MAIN_LIST uses multiple backslash continuations with Windows CRLF line endings
 * When: the sync script runs
 * Then: it joins every continued physical line before parsing the Skill list
 * Regression: repeated continuations must work consistently on Windows .env files
 */
{
  const root = fixture('ignored', ['git-up', 'subagent-router'], 'MAIN_LIST=git-\\\r\nup,subagent-\\\r\nrouter\r\n');
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).skills, ['./skills/git-up', './skills/subagent-router']);
  } finally { remove(root); }
}
/**
 * Given：已生成且未被修改的主 Skill manifest
 * When：以 --check 运行同步脚本
 * Then：校验成功且不写入文件
 * 防回归：防止 CI 校验掩盖清单和 manifest 漂移
 */
{
  const root = fixture('git-up');
  try {
    assert.equal(run(root).status, 0);
    const result = run(root, '--check');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /MAIN_SKILL_MANIFEST_VALID/);
  } finally { remove(root); }
}

/**
 * Given：MAIN_LIST 含重复的 Skill 名
 * When：运行同步脚本
 * Then：拒绝生成并报告重复项
 * 防回归：防止 CLI 中出现重复的可选 Skill
 */
{
  const root = fixture('git-up,git-up');
  try {
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /重复 Skill：git-up/);
  } finally { remove(root); }
}

/**
 * Given：MAIN_LIST 指向不存在的 Skill
 * When：运行同步脚本
 * Then：拒绝生成并准确指出缺失的 SKILL.md
 * 防回归：防止无效路径导致分组安装时静默遗漏
 */
{
  const root = fixture('missing-skill');
  try {
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skills\/missing-skill\/SKILL\.md/);
  } finally { remove(root); }
}

console.log('MAIN_SKILL_MANIFEST_TESTS_PASSED');
