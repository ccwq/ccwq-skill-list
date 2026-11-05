#!/usr/bin/env node
/**
 * Builder for the self-contained runtime `psm-cli.js`.
 *
 * Like the legacy viewer builder this is deliberately NOT a general bundler: it
 * reads a fixed set of factory modules, strips their static imports, rewrites
 * `export` forms into plain declarations and emits a deterministic entry that
 * wires the factories together. The emitted factories are plain source — no
 * runtime eval, no dependency graph scanning, no third-party dependency.
 *
 * The artifact carries the whole CLI (every business command plus `preview`)
 * in one file: it does not need the adjacent sources, the legacy viewer
 * artifact, the skill documents or any node_modules directory.
 *
 * Modes:
 *   node scripts/build-runtime.mjs             write runtime-dist/psm-cli.js + manifest
 *   node scripts/build-runtime.mjs --check     verify the artifact matches sources, write nothing
 *   node scripts/build-runtime.mjs --out-dir X write into X/runtime-dist (isolated verification)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownRuntimeHashes, knownViewerHashes, runtimeVersion } from './release-info.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = resolveOutDir();
const distDir = path.join(outDir, 'runtime-dist');
const distFile = path.join(distDir, 'psm-cli.js');
const manifestFile = path.join(distDir, 'manifest.json');

/** Fixed build order; every entry is (factory name, source file). */
const MODULES = [
  ['store', 'memory-store.mjs'],
  ['lock', 'memory-lock.mjs'],
  ['ledger', 'evidence-ledger.mjs'],
  ['tags', 'memory-tags.mjs'],
  ['cache', 'memory-cache.mjs'],
  ['server', 'viewer-server.mjs'],
  ['page', 'viewer-page.mjs'],
  ['core', 'psm-cli-core.mjs'],
];

/** Known static imports each module may declare (name → imported bindings). */
const IMPORTS = {
  'memory-store.mjs': [],
  'memory-lock.mjs': ['fs', 'path'],
  'evidence-ledger.mjs': ['crypto', 'fs', 'path'],
  'memory-tags.mjs': ['fs', 'path'],
  'memory-cache.mjs': ['crypto', 'fs', 'path'],
  'viewer-server.mjs': [],
  'viewer-page.mjs': [],
  // 核心实现不 import 任何模块：依赖全部由调用方注入，才能被内联打包。
  'psm-cli-core.mjs': [],
};

/**
 * 工厂体内需要从 deps 解构的绑定（跨项目模块导入）。
 * memory-cache.mjs 的 `import { TYPES } from './memory-store.mjs'` 会被
 * stripImports 剥掉，改由入口接线传 `cacheFactory({ TYPES: store.TYPES }, ...)`。
 */
const DEPS_DESTRUCTURE = {
  'memory-cache.mjs': ['TYPES'],
};

function resolveOutDir() {
  const flag = process.argv.indexOf('--out-dir');
  if (flag < 0) return path.resolve(here, '..');
  const value = process.argv[flag + 1];
  if (!value) throw Error('--out-dir 需要一个目录参数');
  return path.resolve(value);
}

function stripImports(source) {
  // Remove lines like: import fs from 'node:fs';
  // and multi-line `import { ... } from './x.mjs';` blocks.
  let out = source.replace(/^import\s+[\w]+\s+from\s+'node:[^']+';\s*$/gm, '');
  out = out.replace(/^import\s*\{[^}]*\}\s*from\s*'[^']+';\s*$/gms, '');
  return out;
}

function rewriteExports(source, file) {
  let out = source;
  out = out.replace(/^export const /gm, 'const ');
  out = out.replace(/^export function /gm, 'function ');
  const names = new Set();
  for (const m of source.matchAll(/^export (?:const|function) ([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  if (/^export\s*\{/m.test(source)) throw Error(`构建器不支持 export 列表: ${file}`);
  if (/^export default/m.test(source)) throw Error(`构建器不支持 export default: ${file}`);
  return { source: out, names: [...names] };
}

function moduleFactory(name, file) {
  // 行尾归一化：autocrlf 环境磁盘源是 CRLF、Linux 是 LF，统一成 LF 后
  // 产物字节与 checkout 行尾无关，跨环境 --check 不再报假漂移。
  const raw = fs.readFileSync(path.join(here, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^#!.*\r?\n/, '');
  const { source, names } = rewriteExports(stripImports(raw), file);
  const nodeImports = IMPORTS[file] || [];
  const params = ['deps', ...nodeImports];
  // 跨项目模块导入：在工厂体开头注入 `const { TYPES } = deps;`，
  // 由入口接线传实际值（见 DEPS_DESTRUCTURE 注释）。
  const depsBindings = (DEPS_DESTRUCTURE[file] || []).join(', ');
  const depsLine = depsBindings ? `  const { ${depsBindings} } = deps;\n` : '';
  const destructure = names.length ? `  return { ${names.join(', ')} };` : '  return {};';
  const body = [
    `const ${name}Factory = (${params.join(', ')}) => {`,
    depsLine + source,
    destructure,
    '};',
  ].join('\n');
  return { body, nodeImports };
}

function build() {
  const factories = MODULES.map(([name, file]) => moduleFactory(name, file));
  const nodeModules = [...new Set(factories.flatMap((f) => f.nodeImports).concat(['http']))];
  const entry = `#!/usr/bin/env node
/*
 * psm-cli.js — project-self-memory 自包含运行时（单文件产物）。
 *
 * 由 skills/project-self-memory/scripts/build-runtime.mjs 生成。
 * 重新生成：node scripts/build-runtime.mjs
 * 一致性校验（不写文件）：node scripts/build-runtime.mjs --check
 *
 * 运行要求：Node 22+。无第三方依赖；不访问网络；只监听 127.0.0.1。
 * 本文件包含全部业务命令与 preview，不依赖相邻源码、旧查看器产物或技能文档。
 *
 * 用法：
 *   node psm-cli.js <command> [options]
 *   node .project-self-memory/psm-cli.js <command> [options]
 *   node psm-cli.js preview [--port N] [--no-open]
 *
 * 记忆库位置：显式 --project-root > 运行时所在项目的 .project-self-memory/
 * 绑定 > 当前工作目录。
 */
'use strict';

(async () => {
const [${nodeModules.map((m) => `${m.replace(/^node:/, '')}`).join(', ')}] = await Promise.all([
${nodeModules.map((m) => `  import('node:${m.replace(/^node:/, '')}').then((m) => m.default || m),`).join('\n')}
]);

${factories.map((f) => f.body).join('\n\n')}

const store = storeFactory({});
const lock = lockFactory({}, ${['fs', 'path'].join(', ')});
const ledger = ledgerFactory({}, ${['crypto', 'fs', 'path'].join(', ')});
const tags = tagsFactory({}, fs, path);
const cache = cacheFactory({ TYPES: store.TYPES }, crypto, fs, path);
const server = serverFactory({});
const page = pageFactory({});
const core = coreFactory({});

// 发行信息随产物内联：消费项目不需要额外的清单文件。
const release = {
  runtimeVersion: ${JSON.stringify(runtimeVersion)},
  knownRuntimeHashes: ${JSON.stringify(knownRuntimeHashes)},
  knownViewerHashes: ${JSON.stringify(knownViewerHashes)},
};

// 单文件产物自身即当前官方发行物。
core.createCli({
  fs, path, crypto, process, http,
  store, lock, ledger, tags, cache, server, page,
  release,
  bundle: true,
  selfPath: path.resolve(process.argv[1] || '.'),
}).run(process.argv.slice(2));
})().catch((error) => {
  console.error('PSM_ERROR: ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
`;
  return entry.replace(/\r\n/g, '\n');
}

function sha(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

function main() {
  const check = process.argv.includes('--check');
  const output = build();
  if (check) {
    if (!fs.existsSync(distFile)) { console.error('PSM_RUNTIME_DRIFT: 产物缺失'); process.exit(1); }
    // 产物在 autocrlf 环境检出时磁盘行尾是 CRLF（仓库内为 LF），比对按内容
    // 归一化，只对真实内容漂移报警。
    const current = fs.readFileSync(distFile, 'utf8').replace(/\r\n/g, '\n');
    if (current !== output) {
      console.error('PSM_RUNTIME_DRIFT: 产物与源码不一致；运行 node scripts/build-runtime.mjs 重新生成');
      process.exit(1);
    }
    console.log('PSM_RUNTIME_CONSISTENT');
    return;
  }
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(distFile, output);
  const manifest = {
    name: 'psm-cli.js',
    runtime_version: runtimeVersion,
    hashes: { [sha(output)]: { built_from: MODULES.map(([, f]) => f) } },
  };
  let existing = { hashes: {} };
  if (fs.existsSync(manifestFile)) {
    try { existing = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { existing = { hashes: {} }; }
  }
  existing.name = manifest.name;
  existing.runtime_version = manifest.runtime_version;
  existing.hashes = { ...(existing.hashes || {}), ...manifest.hashes };
  fs.writeFileSync(manifestFile, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(`PSM_RUNTIME_BUILT: ${distFile} (${sha(output).slice(0, 12)})`);
}
main();
