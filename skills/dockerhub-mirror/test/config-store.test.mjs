import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyConfig, parseConfig, serializeConfig, writeConfigAtomic, readConfig, upsertActive, moveToQuarantine, removeRecord, withFileLock } from '../scripts/lib/config-store.mjs';

/**
 * Given：包含活跃和隔离镜像记录的缓存配置
 * When：序列化后重新解析配置
 * Then：首行日期元数据及两个分区的字段保持一致
 * 防回归：避免 INI 缓存读写丢失镜像状态或含换行的错误信息
 */
test('serializes first-line date metadata and round-trips active/quarantine sections', () => {
  const config = emptyConfig();
  config.updatedAt = '2026-08-05T03:55:00.000Z';
  upsertActive(config, { url: 'https://docker.example.com/path', status: 'active', source: 'test', api_ms: 10, manifest_ms: 20, success_count: 1, failure_count: 0, consecutive_failures: 0 });
  moveToQuarantine(config, { url: 'https://bad.example.com', source: 'test', failure_count: 3, consecutive_failures: 3, last_error: 'timeout\nline' });
  const text = serializeConfig(config);
  assert.match(text.split('\n')[0], /^; updated_at=2026-08-05/);
  const parsed = parseConfig(text);
  assert.equal(parsed.mirrors[0].url, 'https://docker.example.com/path');
  assert.equal(parsed.quarantine[0].status, 'quarantined');
  assert.equal(parsed.quarantine[0].last_error, 'timeout\nline');
});

/**
 * Given：临时缓存文件与一条活跃镜像记录
 * When：使用文件锁进行原子写入、读取和删除
 * Then：记录可读且删除后缓存为空
 * 防回归：避免并发缓存更新留下不完整或过期记录
 */
test('writes atomically and supports CRUD with a lock', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mirror-skill-'));
  const file = path.join(dir, 'cache.ini');
  const config = emptyConfig();
  upsertActive(config, { url: 'https://one.example', source: 'test' });
  await withFileLock(file, () => writeConfigAtomic(file, config));
  const read = await readConfig(file);
  assert.equal(read.mirrors.length, 1);
  assert.equal(removeRecord(read, 'one.example'), true);
  await writeConfigAtomic(file, read);
  assert.equal((await readConfig(file)).mirrors.length, 0);
  await fs.rm(dir, { recursive: true, force: true });
});
