#!/usr/bin/env node
/**
 * Builder for the single-file viewer `view-memoery.js`.
 *
 * This is deliberately NOT a bundler: it reads the factory modules in a fixed
 * order, strips their (static, same-directory) imports, rewrites `export`
 * forms into plain declarations, embeds each transformed source as a factory
 * expression and emits a deterministic entry that wires the factories
 * together. No dependency graph scanning, no import rewriting beyond the
 * known module set, no runtime eval — the emitted factories are plain source.
 *
 * Modes:
 *   node scripts/build-viewer.mjs            write viewer-dist/view-memoery.js + manifest
 *   node scripts/build-viewer.mjs --check    verify the dist matches sources, write nothing
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, '..', 'viewer-dist');
const distFile = path.join(distDir, 'view-memoery.js');
const manifestFile = path.join(distDir, 'manifest.json');

/** Fixed build order; every entry is (exported name, source file). */
const MODULES = [
  ['store', 'memory-store.mjs'],
  ['lock', 'memory-lock.mjs'],
  ['ledger', 'evidence-ledger.mjs'],
  ['tags', 'memory-tags.mjs'],
  ['cache', 'memory-cache.mjs'],
  ['server', 'viewer-server.mjs'],
  ['page', 'viewer-page.mjs'],
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
};

/**
 * 工厂体内需要从 deps 解构的绑定（跨项目模块导入）。
 * memory-cache.mjs 的 `import { TYPES } from './memory-store.mjs'` 会被
 * stripImports 剥掉，改由入口接线传 `cacheFactory({ TYPES: store.TYPES }, ...)`。
 */
const DEPS_DESTRUCTURE = {
  'memory-cache.mjs': ['TYPES'],
};

function stripImports(source, file) {
  // Remove lines like: import fs from 'node:fs';  /  import crypto from 'node:crypto';
  // and multi-line `import { ... } from './x.mjs';` blocks.
  let out = source.replace(/^import\s+[\w]+\s+from\s+'node:[^']+';\s*$/gm, '');
  out = out.replace(/^import\s*\{[^}]*\}\s*from\s*'[^']+';\s*$/gms, '');
  return out;
}

function rewriteExports(source, file) {
  let out = source;
  // `export const NAME =` → `const NAME =`
  out = out.replace(/^export const /gm, 'const ');
  // `export function NAME` → `function NAME`
  out = out.replace(/^export function /gm, 'function ');
  // Collect exported names for the factory return.
  const names = new Set();
  for (const m of source.matchAll(/^export (?:const|function) ([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  // `export { a, b as c };` — not used by our modules; fail loudly if present.
  if (/^export\s*\{/m.test(source)) throw Error(`构建器不支持 export 列表: ${file}`);
  if (/^export default/m.test(source)) throw Error(`构建器不支持 export default: ${file}`);
  return { source: out, names: [...names] };
}

function safeEmbed(source) {
  // JSON string, then guard the only HTML-relevant escape: "</script" inside a
  // <script> block would terminate the element early.
  return JSON.stringify(source).replace(/<\/script/gi, '<\\/script');
}

function moduleFactory(name, file) {
  // \r?\n 兼容 CRLF 源：`/^#!.*\n/` 在 CRLF 文件上失配（`.` 不匹配 \r），
  // shebang 会残留进工厂体，产物语法错误。
  const raw = fs.readFileSync(path.join(here, file), 'utf8').replace(/^#!.*\r?\n/, '');
  const stripped = stripImports(raw, file);
  const { source, names } = rewriteExports(stripped, file);
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
 * view-memoery.js — project-self-memory 紧凑查看器（自包含单文件产物）。
 *
 * 由 skills/project-self-memory/scripts/build-viewer.mjs 生成。
 * 重新生成：node scripts/build-viewer.mjs
 * 一致性校验（不写文件）：node scripts/build-viewer.mjs --check
 *
 * 运行要求：Node 22+（以 Node 24 验证）。无第三方依赖；不访问网络；
 * 只监听 127.0.0.1；记忆目录固定为脚本所在目录内最近一层的
 * .project-self-memory/（项目根与 .project-self-memory/ 内启动均可）。
 *
 * 用法：
 *   node view-memoery.js [--port N] [--no-open]
 *   node .project-self-memory/view-memoery.js [--port N] [--no-open]
 * 输出：带 #token= 的访问地址。令牌只在进程与页面内存中，不写入磁盘。
 * 默认用系统默认浏览器打开该地址；--no-open 或 PSM_VIEWER_OPEN=0 禁止，
 * PSM_VIEWER_OPEN=echo 只打印打开地址（无头环境与测试诊断用）。
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

const argv = process.argv.slice(2);
const portFlag = argv.indexOf('--port');
const port = portFlag >= 0 ? Number(argv[portFlag + 1]) : 0;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PSM_VIEWER_ERROR: --port 必须是 0..65535 的整数');
  process.exit(1);
}
// 默认用系统默认浏览器打开带令牌的地址；--no-open 或 PSM_VIEWER_OPEN=0 禁止，
// 打开失败不致命。PSM_VIEWER_OPEN=echo 只打印地址不执行，供无头环境与测试
// 诊断（优先级最高）。--open 保留为兼容写法，与默认行为相同。
const openMode = process.env.PSM_VIEWER_OPEN === 'echo'
  ? 'echo'
  : (argv.includes('--no-open') || process.env.PSM_VIEWER_OPEN === '0' ? '' : 'open');
function launchBrowser(url) {
  if (openMode === 'echo') { console.log('PSM_VIEWER_OPEN_URL: ' + url); return; }
  const childProcess = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  import('node:child_process').then(({ spawn }) => {
    const child = spawn(childProcess[0], childProcess[1], { detached: true, stdio: 'ignore', shell: false });
    child.on('error', () => console.log('PSM_VIEWER_OPEN_FAILED: 请手动复制上方地址到浏览器'));
    child.unref();
  }).catch(() => console.log('PSM_VIEWER_OPEN_FAILED: 请手动复制上方地址到浏览器'));
}

// Memory directory is pinned to the nearest '.project-self-memory/' inside the
// script's own directory; arbitrary paths are refused.
// 部署契约：脚本随 init 放在 '.project-self-memory/' 内（basename 为
// '.project-self-memory' 时取父目录）；复制到项目根手动启动也受支持。
// 不用 require.resolve：ESM 宿主没有 require。
const scriptDir = path.dirname(path.resolve(process.argv[1] || '.'));
const projectRoot = path.basename(scriptDir) === '.project-self-memory' ? path.dirname(scriptDir) : scriptDir;
const token = crypto.randomBytes(32).toString('hex');
const { server: httpServer } = server.createViewerServer({
  fs, path, crypto, http, store, lock, ledger, tags,
  projectRoot, token, pageHtml: page.VIEWER_PAGE_HTML,
});
httpServer.listen(port, '127.0.0.1', () => {
  const address = httpServer.address();
  const url = 'http://127.0.0.1:' + address.port + '/#token=' + token;
  console.log('PSM_VIEWER_URL: ' + url);
  console.log('记忆目录: ' + path.join(projectRoot, '.project-self-memory'));
  console.log('只监听本机回环；停止服务请按 Ctrl+C。');
  if (openMode === 'open' || openMode === 'echo' || openMode === '1') launchBrowser(url);
});
})().catch((error) => {
  console.error('PSM_VIEWER_ERROR: ' + error.message);
  process.exit(1);
});
`;

  // 入口不依赖 require（ESM 宿主没有 require），脚本目录用 process.argv[1] 解析。
  return entry;
}

function sha(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

function main() {
  const check = process.argv.includes('--check');
  const output = build();
  if (check) {
    if (!fs.existsSync(distFile)) { console.error('PSM_VIEWER_DRIFT: 产物缺失'); process.exit(1); }
    const current = fs.readFileSync(distFile, 'utf8');
    if (current !== output) {
      console.error('PSM_VIEWER_DRIFT: 产物与源码不一致；运行 node scripts/build-viewer.mjs 重新生成');
      process.exit(1);
    }
    console.log('PSM_VIEWER_CONSISTENT');
    return;
  }
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(distFile, output);
  const manifest = {
    name: 'view-memoery.js',
    hashes: { [sha(output)]: { built_from: MODULES.map(([, f]) => f) } },
  };
  let existing = { hashes: {} };
  if (fs.existsSync(manifestFile)) {
    try { existing = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { existing = { hashes: {} }; }
  }
  existing.name = manifest.name;
  existing.hashes = { ...(existing.hashes || {}), ...manifest.hashes };
  fs.writeFileSync(manifestFile, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(`PSM_VIEWER_BUILT: ${distFile} (${sha(output).slice(0, 12)})`);
}
main();
