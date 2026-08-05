import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { normalizeMirrorUrl, mirrorId, defaultConfigPath } from './normalize.mjs';

const SECTION_RE = /^\[(mirror|quarantine)\s+"([^"]+)"\]$/;

export function resolveConfigPath(explicitPath) {
  return path.resolve(explicitPath || process.env.DOCKERHUB_MIRROR_CONFIG || defaultConfigPath(os.homedir()));
}

export function emptyConfig(formatVersion = 1) {
  return { updatedAt: null, formatVersion, mirrors: [], quarantine: [] };
}

function unescapeValue(value) {
  return value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
}

function escapeValue(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function coerceValue(key, value) {
  if (value === '') return null;
  if (['api_ms', 'manifest_ms', 'ttfb_ms', 'throughput_kib_s', 'score', 'success_count', 'failure_count', 'consecutive_failures'].includes(key)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return unescapeValue(value);
}

export function parseConfig(text) {
  const config = emptyConfig();
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (line.startsWith(';') || line.startsWith('#')) {
      const meta = line.replace(/^[;#]\s*/, '');
      const eq = meta.indexOf('=');
      if (eq > 0) {
        const key = meta.slice(0, eq).trim();
        const value = meta.slice(eq + 1).trim();
        if (key === 'updated_at') config.updatedAt = value || null;
        if (key === 'format_version') config.formatVersion = Number(value) || 1;
      }
      continue;
    }
    const section = line.match(SECTION_RE);
    if (section) {
      current = { kind: section[1], id: section[2] };
      const target = current.kind === 'mirror' ? config.mirrors : config.quarantine;
      target.push(current);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 1 || !current) throw new Error(`Invalid INI syntax at line ${index + 1}: ${lines[index]}`);
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    current[key] = coerceValue(key, value);
  }
  for (const record of [...config.mirrors, ...config.quarantine]) {
    if (!record.url) throw new Error(`Missing url in section ${record.id}`);
    record.url = normalizeMirrorUrl(record.url);
    record.id = mirrorId(record.url);
    record.status ||= record.kind === 'quarantine' ? 'quarantined' : 'active';
    delete record.kind;
  }
  return config;
}

function recordLines(kind, record) {
  const order = [
    'url', 'status', 'source', 'api_ms', 'manifest_ms', 'ttfb_ms', 'throughput_kib_s', 'score',
    'success_count', 'failure_count', 'consecutive_failures', 'last_success_at', 'last_failure_at',
    'tested_at', 'last_error', 'note'
  ];
  const lines = [`[${kind} "${mirrorId(record.url)}"]`];
  for (const key of order) {
    if (!(key in record)) continue;
    lines.push(`${key}=${escapeValue(record[key])}`);
  }
  const extras = Object.keys(record).filter((key) => !order.includes(key) && key !== 'id').sort();
  for (const key of extras) lines.push(`${key}=${escapeValue(record[key])}`);
  return lines.join('\n');
}

export function serializeConfig(config, now = new Date()) {
  const updatedAt = config.updatedAt || now.toISOString();
  const active = [...config.mirrors].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.url.localeCompare(b.url));
  const quarantined = [...config.quarantine].sort((a, b) => a.url.localeCompare(b.url));
  const blocks = [`; updated_at=${updatedAt}`, `; format_version=${config.formatVersion || 1}`];
  for (const record of active) blocks.push(recordLines('mirror', record));
  for (const record of quarantined) blocks.push(recordLines('quarantine', record));
  return `${blocks.join('\n\n')}\n`;
}

export async function readConfig(configPath, { allowMissing = true } = {}) {
  try {
    const text = await fs.readFile(configPath, 'utf8');
    return parseConfig(text);
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return emptyConfig();
    throw error;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withFileLock(configPath, operation, { staleMs = 30000, retries = 30, retryMs = 100 } = {}) {
  const lockPath = `${configPath}.lock`;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  let handle;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          await fs.unlink(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError.code === 'ENOENT') continue;
        throw statError;
      }
      if (attempt === retries) throw new Error(`Timed out waiting for config lock: ${lockPath}`);
      await sleep(retryMs);
    }
  }
  try {
    return await operation();
  } finally {
    try { await handle?.close(); } catch {}
    try { await fs.unlink(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function renameReplacing(source, destination) {
  if (process.platform !== 'win32') {
    await fs.rename(source, destination);
    return;
  }
  const backup = `${destination}.replace-${process.pid}-${Date.now()}`;
  let hadDestination = false;
  try {
    await fs.rename(destination, backup);
    hadDestination = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await fs.rename(source, destination);
    if (hadDestination) await fs.unlink(backup).catch(() => {});
  } catch (error) {
    if (hadDestination) await fs.rename(backup, destination).catch(() => {});
    throw error;
  }
}

export async function writeConfigAtomic(configPath, config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const now = new Date();
  config.updatedAt = now.toISOString();
  const tempPath = path.join(path.dirname(configPath), `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, serializeConfig(config, now), { encoding: 'utf8', mode: 0o600 });
  try {
    await renameReplacing(tempPath, configPath);
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

export async function backupCorruptConfig(configPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${configPath}.corrupt-${stamp}`;
  await fs.copyFile(configPath, backupPath);
  return backupPath;
}

export function findRecord(config, url) {
  const normalized = normalizeMirrorUrl(url);
  return config.mirrors.find((item) => item.url === normalized) || config.quarantine.find((item) => item.url === normalized) || null;
}

export function upsertActive(config, record) {
  const url = normalizeMirrorUrl(record.url);
  config.quarantine = config.quarantine.filter((item) => item.url !== url);
  const index = config.mirrors.findIndex((item) => item.url === url);
  const merged = { ...(index >= 0 ? config.mirrors[index] : {}), ...record, url, status: record.status || 'active' };
  if (index >= 0) config.mirrors[index] = merged;
  else config.mirrors.push(merged);
  return merged;
}

export function moveToQuarantine(config, record) {
  const url = normalizeMirrorUrl(record.url);
  config.mirrors = config.mirrors.filter((item) => item.url !== url);
  const index = config.quarantine.findIndex((item) => item.url === url);
  const merged = { ...(index >= 0 ? config.quarantine[index] : {}), ...record, url, status: 'quarantined' };
  if (index >= 0) config.quarantine[index] = merged;
  else config.quarantine.push(merged);
  return merged;
}

export function removeRecord(config, url) {
  const normalized = normalizeMirrorUrl(url);
  const before = config.mirrors.length + config.quarantine.length;
  config.mirrors = config.mirrors.filter((item) => item.url !== normalized);
  config.quarantine = config.quarantine.filter((item) => item.url !== normalized);
  return before !== config.mirrors.length + config.quarantine.length;
}
