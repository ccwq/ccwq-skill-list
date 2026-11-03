/**
 * 预加载钩子：统计执行器发起的 Git 子进程数量。
 *
 * 通过 NODE_OPTIONS="--import ..." 注入到目标进程。包装 child_process.spawnSync
 * 后计数，不依赖执行器内部实现，也不受 PATH 解析影响。
 *
 * 计数文件路径由 GIT_UP_GIT_CALL_COUNT 环境变量指定。
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const originalSpawnSync = childProcess.spawnSync;

const counterPath = process.env.GIT_UP_GIT_CALL_COUNT;

childProcess.spawnSync = function patchedSpawnSync(command, args, options) {
  if (command === 'git') {
    try {
      const current = Number.parseInt(fs.readFileSync(counterPath, 'utf8').trim(), 10);
      fs.writeFileSync(counterPath, String((Number.isFinite(current) ? current : 0) + 1), 'utf8');
    } catch { /* 计数失败不影响被测进程 */ }
  }
  return originalSpawnSync.call(this, command, args, options);
};
