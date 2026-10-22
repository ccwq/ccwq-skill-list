#!/usr/bin/env node
/**
 * Locking and durable-write protection for memory.md.
 *
 * Lock order is always memory.lock → evidence.lock. Callers that already hold
 * memory.lock must never re-acquire it; nested acquisition deadlocks. The
 * lock file is held with `wx` create; a stale lock is only reclaimed when the
 * recorded owner process is confirmed dead, never by age alone.
 */
import fs from 'node:fs';
import path from 'node:path';

export const MEMORY_LOCK_FILE = 'memory.lock';
export const EVIDENCE_LOCK_FILE = 'evidence.lock';

export function memoryPaths(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const base = path.join(root, '.project-self-memory');
  return {
    root,
    base,
    memory: path.join(base, 'memory.md'),
    ledger: path.join(base, 'evidence.jsonl'),
    lock: path.join(base, MEMORY_LOCK_FILE),
    evidenceLock: path.join(base, EVIDENCE_LOCK_FILE),
    backups: path.join(base, 'backups'),
  };
}

function ownerAlive(lockFile) {
  try {
    const meta = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (typeof meta.pid === 'number' && meta.pid > 0) {
      try { process.kill(meta.pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
    }
  } catch { /* unreadable or racing removal: owner unknown */ }
  return null; // unknown owner → do not delete
}

function tryAcquire(lockFile) {
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return false;
  }
}

function release(lockFile) {
  try { fs.unlinkSync(lockFile); } catch { /* already released */ }
}

function sleepSync(ms) {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, Math.max(1, ms));
}

/**
 * Synchronous acquisition for CLI use. Waits up to timeoutMs. A lock whose
 * recorded owner is confirmed dead is reclaimed; any other case times out.
 */
export function acquireLockSync(lockFile, { timeoutMs = 15000 } = {}) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const started = Date.now();
  while (!tryAcquire(lockFile)) {
    if (Date.now() - started >= timeoutMs) throw Error(`${path.basename(lockFile)} 锁超时，拒绝写入`);
    if (ownerAlive(lockFile) === false) { try { fs.unlinkSync(lockFile); } catch { /* raced */ } continue; }
    sleepSync(50);
  }
  return { release: () => release(lockFile) };
}

/**
 * Non-blocking acquisition for HTTP use. Returns null when busy so the server
 * can answer 503 immediately instead of stalling the event loop.
 */
export function tryAcquireLock(lockFile) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  if (!tryAcquire(lockFile)) return null;
  return { release: () => release(lockFile) };
}

/**
 * Acquire memory.lock then evidence.lock (the only legal order). Returns null
 * when either is busy; any lock already taken is released before returning.
 */
export function tryAcquireStoreLocks(projectRoot) {
  const { lock, evidenceLock } = memoryPaths(projectRoot);
  const memory = tryAcquireLock(lock);
  if (!memory) return null;
  const evidence = tryAcquireLock(evidenceLock);
  if (!evidence) { memory.release(); return null; }
  return { release: () => { evidence.release(); memory.release(); } };
}

/** Blocking variant of tryAcquireStoreLocks for CLI paths. */
export function acquireStoreLocksSync(projectRoot, options = {}) {
  const { lock, evidenceLock } = memoryPaths(projectRoot);
  const memory = acquireLockSync(lock, options);
  try {
    const evidence = acquireLockSync(evidenceLock, options);
    return { release: () => { evidence.release(); memory.release(); } };
  } catch (error) { memory.release(); throw error; }
}

export function acquireMemoryLockSync(projectRoot, options = {}) {
  const { lock } = memoryPaths(projectRoot);
  return acquireLockSync(lock, options);
}

export function tryAcquireMemoryLock(projectRoot) {
  const { lock } = memoryPaths(projectRoot);
  return tryAcquireLock(lock);
}

/** Raw-bytes backup before a durable replacement. Failure must abort the write. */
export function backupMemoryFile(projectRoot, bytes) {
  const { memory, backups } = memoryPaths(projectRoot);
  fs.mkdirSync(backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..*$/, '');
  const name = `memory-${stamp}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.md`;
  const file = path.join(backups, name);
  fs.writeFileSync(file, bytes);
  // Read back to confirm the backup is intact before it may be trusted.
  if (!fs.readFileSync(file).equals(bytes)) throw Error(`备份校验失败: ${file}`);
  return { file, name, source: memory };
}

/**
 * Atomic same-directory replacement: write a temp file, fsync, rename.
 * The temp file is cleaned up on failure so a crash never leaves a torn file.
 */
export function atomicReplace(targetFile, bytes) {
  const temp = `${targetFile}.psm-${process.pid}-${Date.now()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'w');
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(temp, targetFile);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* temp may not exist */ }
    throw error;
  }
}
