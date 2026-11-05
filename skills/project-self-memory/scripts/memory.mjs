#!/usr/bin/env node
/**
 * PSM CLI 源码入口（薄兼容层）。
 *
 * 业务实现全部在 psm-cli-core.mjs 的 createCli 工厂里；本文件只负责注入依赖
 * 并把参数交给核心。这样源码入口与单文件产物 runtime-dist/psm-cli.js 共用
 * 同一份实现，不会出现第二套存储、锁或写入语义。
 *
 * 宿主适配器（scripts/memory-session.mjs、scripts/reference-host.mjs）继续调用
 * 本入口，默认路径与显式 CLI 覆盖能力保持不变。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import * as store from './memory-store.mjs';
import * as lock from './memory-lock.mjs';
import * as ledger from './evidence-ledger.mjs';
import * as tags from './memory-tags.mjs';
import * as cache from './memory-cache.mjs';
import * as server from './viewer-server.mjs';
import * as page from './viewer-page.mjs';
import { createCli } from './psm-cli-core.mjs';
import { knownRuntimeHashes, knownViewerHashes, runtimeVersion } from './release-info.mjs';

const selfPath = fileURLToPath(import.meta.url);

createCli({
  fs, path, crypto, process, http,
  store, lock, ledger, tags, cache, server, page,
  release: { runtimeVersion, knownRuntimeHashes, knownViewerHashes },
  bundle: false,
  selfPath,
}).run(process.argv.slice(2));
