import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relative) {
  return fs.readFile(path.join(root, relative), 'utf8');
}

/**
 * Given：已纳入管理的 SKILL.md
 * When：检查描述与步骤完成标准
 * Then：Skill 保持面向模型的触发描述和七个有序步骤
 * 防回归：避免文档结构退化导致 Skill 触发或执行流程失效
 */
test('SKILL uses a model-facing triage description and ordered completion criteria', async () => {
  const skill = await read('SKILL.md');
  assert.match(skill, /^---\nname: dockerhub-mirror\ndescription: Triage /);
  const steps = [...skill.matchAll(/^## Step \d+ — /gm)];
  const criteria = [...skill.matchAll(/^\*\*Complete when:\*\*/gm)];
  assert.equal(steps.length, 7);
  assert.equal(criteria.length, steps.length);
});

/**
 * Given：Skill 的核心执行说明
 * When：检查授权门禁和 CLI 入口
 * Then：必须使用约定确认语及绝对 Skill 根目录入口
 * 防回归：避免未经授权的写操作或因工作目录错误导致 CLI 失效
 */
test('common gate and absolute entrypoint are inline', async () => {
  const skill = await read('SKILL.md');
  assert.match(skill, /exact consensus phrase `ok`/);
  assert.match(skill, /exact execution phrase `授权执行`/);
  assert.match(skill, /<skill-root>\/bin\/dockerhub-mirror\.mjs/);
  assert.doesNotMatch(skill, /node scripts\//);
});

/**
 * Given：Skill 正文和 CLI 参考文档
 * When：检查命令说明的引用关系
 * Then：正文链接到唯一 CLI 参考且不存在废弃 usage 文档
 * 防回归：避免多份命令文档发生漂移
 */
test('CLI commands have one disclosed source of truth', async () => {
  const skill = await read('SKILL.md');
  const cli = await read('references/cli.md');
  assert.match(skill, /\[the CLI reference\]\(references\/cli\.md\)/);
  assert.match(cli, /Side-effect classes/);
  await assert.rejects(() => fs.access(path.join(root, 'references/usage.md')));
});
