import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTags, normaliseTaxonomy, loadTagTaxonomy, suggestTaxonomy } from '../scripts/memory-tags.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordVersion } from '../scripts/evidence-ledger.mjs';

/**
 * Given：正文包含主机前缀，项目规则声明组件与跨主机标签
 * When：派生标签后叠加人工增删
 * Then：返回多个确定排序的标签，记录版本保持不变
 * 防回归：自动分类改写正文或使历史评分脱钩
 */
test('derives prefixes and project literal rules without changing semantic version', () => {
  const record = { id: '0001', type: 'fact', status: 'active', group: null, content: '[host_scope=tenc] OmniRoute links qxub' };
  const before = recordVersion(record);
  const taxonomy = normaliseTaxonomy({ version: 1, tags: [
    { name: 'component:omniroute', any: ['OmniRoute'] },
    { name: 'host:qxub', all: ['links', 'qxub'] },
  ], overrides: { '0001': { add: ['shared'], remove: ['host_scope:tenc'] } } });
  assert.deepEqual(deriveTags(record, taxonomy), ['component:omniroute', 'host:qxub', 'shared']);
  assert.equal(recordVersion(record), before);
  assert.deepEqual(deriveTags({ content: '[owner=frontend] text' }, normaliseTaxonomy()), ['owner:frontend']);
});

/**
 * Given：标签旁路文件缺失、为空、非法或包含正则字段
 * When：加载分类标准
 * Then：缺失与空文件使用内置规则，非法文件仅告警并关闭标签
 * 防回归：可选元数据阻塞记忆功能或引入可执行正则
 */
test('optional taxonomy fails open without accepting unknown fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-tags-'));
  const base = path.join(root, '.project-self-memory'); fs.mkdirSync(base);
  const file = path.join(base, 'tags.json');
  assert.equal(loadTagTaxonomy(root).enabled, true);
  fs.writeFileSync(file, ''); assert.equal(loadTagTaxonomy(root).enabled, true);
  fs.writeFileSync(file, '{');
  assert.equal(loadTagTaxonomy(root).enabled, false);
  assert.equal(loadTagTaxonomy(root).diagnostics[0].impact, 'warning');
  assert.throws(() => normaliseTaxonomy({ version: 1, tags: [{ name: 'x', pattern: '(a+)+' }] }), /未知字段/);
  assert.throws(() => normaliseTaxonomy({ version: 1, tags: [{ name: 'UPPER' }] }), /小写/);
  assert.throws(() => normaliseTaxonomy({ version: 1, tags: [], overrides: [] }), /对象/);
});

/**
 * Given：超过八条规则命中，用户显式指定一个额外标签
 * When：派生标签及从现有记忆生成建议
 * Then：最多八标签且保留显式标签，建议不修改输入或编造类别
 * 防回归：标签数量失控及词频提案自动成为事实
 */
test('caps labels and suggests only observable prefixes and recurring terms', () => {
  const taxonomy = normaliseTaxonomy({ version: 1, tags: Array.from({ length: 10 }, (_, i) => ({ name: `tag${i}`, any: ['match'] })), overrides: { '0001': { add: ['manual'] } } });
  const labels = deriveTags({ id: '0001', content: 'match' }, taxonomy);
  assert.equal(labels.length, 8); assert.ok(labels.includes('manual'));
  const records = [{ id: '0001', content: '[host_scope=tenc] OmniRoute maintenance' }, { id: '0002', content: 'OmniRoute routing' }];
  const result = suggestTaxonomy(records);
  assert.equal(result.covered_records, 1);
  assert.deepEqual(result.uncovered_ids, ['0002']);
  assert.ok(result.candidates.some((candidate) => candidate.term === 'omniroute' && candidate.record_count === 2));
  assert.equal(result.taxonomy.tags[0].name, 'host_scope:tenc');
});

/**
 * Given：参考项目使用逗号表示一条记忆适用于两台主机
 * When：从行首前缀派生标签
 * Then：分别生成两个主机标签，不把逗号存入标签
 * 防回归：rd-tencent 的跨主机前缀被静默忽略
 */
test('supports comma separated scope values in existing project prefixes', () => {
  assert.deepEqual(deriveTags({ content: '[host_scope=qbox,tgate] shared transport' }), ['host_scope:qbox', 'host_scope:tgate']);
});

/**
 * Given：项目现有分类标准通过关键词覆盖了无前缀记忆
 * When：生成分类建议与覆盖率
 * Then：覆盖率包含现有规则，提案保留人工修正
 * 防回归：建议命令只统计前缀并丢弃既有分类标准
 */
test('suggestions preserve existing taxonomy and report its actual coverage', () => {
  const taxonomy = normaliseTaxonomy({ version: 1, tags: [{ name: 'module:proxy', any: ['gateway'] }], overrides: { '0001': { add: ['reviewed'] } } });
  const result = suggestTaxonomy([{ id: '0001', content: 'gateway routing' }], { taxonomy, enabled: true });
  assert.equal(result.covered_records, 1);
  assert.equal(result.taxonomy.tags[0].name, 'module:proxy');
  assert.deepEqual(result.taxonomy.overrides['0001'].add, ['reviewed']);
});

/**
 * Given：损坏记录的 ID 与对象原型属性同名，另有大量不同前缀
 * When：派生标签并生成受限分类提案
 * Then：坏 ID 不触发原型读取，提案最多包含 256 项并报告截断
 * 防回归：可选标签阻塞既有损坏记录隔离或大库分类建议
 */
test('isolates prototype-like IDs and bounds suggested taxonomy', () => {
  assert.deepEqual(deriveTags({ id: 'constructor', content: '[scope=one] text' }), ['scope:one']);
  const records = Array.from({ length: 257 }, (_, index) => ({ id: String(index + 1).padStart(4, '0'), content: `[scope=v${index}] text` }));
  const result = suggestTaxonomy(records);
  assert.equal(result.taxonomy.tags.length, 256);
  assert.equal(result.truncated_tags, 1);
});

