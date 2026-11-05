import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../scripts/memory.mjs');
const builder = path.resolve(here, '../scripts/build-viewer.mjs');
const dist = path.resolve(here, '../viewer-dist/view-memoery.js');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'psm-legacy-'));
const memory = (root) => path.join(root, '.project-self-memory', 'memory.md');
const record = (id, content, status = 'active') => `<!-- <psm id="${id}" type="fact" status="${status}" positive="0" negative="0" created_at="2026-08-05T00:00:00Z" last_scored_at="" /> -->\n${content}\n`;
const store = (next = '0002') => `<!-- <psm-store version="1" next_id="${next}" group_dimension="" /> -->\n`;

function runCli(root, ...argv) {
  return execFileSync(process.execPath, [cli, '--project-root', root, ...argv], { encoding: 'utf8', env: { ...process.env, PSM_QUIET: '1' } });
}

/** 把 LF 文本改成 CRLF/LF 逐行交替；行尾之外的字节一字不动。 */
function alternateEol(text) {
  const lines = text.split('\n');
  const tail = lines.pop(); // 文件末尾的换行之后的剩余内容
  return lines.map((line, index) => (index % 2 ? `${line}\r\n` : `${line}\n`)).join('') + tail;
}

/**
 * Given：源码与产物（autocrlf 检出会把仓库内 LF 的产物 smudge 成磁盘 CRLF）
 * When：运行构建器两次并 --check
 * Then：两次产物内容一致（首读归一化行尾，忽略 checkout 行尾差异）；
 *       --check 通过；产物能被 node 解析（仅首行一个 shebang，工厂体内无残留 `#!`）
 * 防回归：CRLF 源上 shebang 剥离失配，坏产物字节级可复现却不可运行；
 *         产物随时间漂移或不可审计；fresh checkout 上磁盘行尾误报漂移
 */
test('build is reproducible and drift-checkable', () => {
  const normalize = (text) => text.replace(/\r\n/g, '\n');
  const original = fs.readFileSync(dist);
  const first = normalize(original.toString('utf8'));
  execFileSync(process.execPath, [builder], { encoding: 'utf8' });
  const second = normalize(fs.readFileSync(dist, 'utf8'));
  assert.equal(first, second);
  // 还原工作区原始字节，测试不把仓库变成 dirty。
  fs.writeFileSync(dist, original);
  // 产物可运行性防线：坏产物字节比对是盲的，必须让 node 自己做语法校验。
  execFileSync(process.execPath, ['--check', dist]);
  const artifact = fs.readFileSync(dist, 'utf8');
  const shebangLines = artifact.split('\n').filter((line) => line.startsWith('#!'));
  assert.equal(shebangLines.length, 1, 'shebang 只允许出现在产物第 1 行');
  const check = execFileSync(process.execPath, [builder, '--check'], { encoding: 'utf8' });
  assert.match(check, /PSM_VIEWER_CONSISTENT/);
});

/**
 * Given：临时副本目录，模块源被改写成 CRLF 或 CRLF/LF 逐行交替（注入前先归一
 *       到 LF，保证构造的是纯混合行尾而非「在 CRLF 上再叠 CRLF」）
 * When：用副本里的构建器（`here` 指向副本目录）各构建一次
 * Then：两种行尾形态的产物与仓库产物内容一致——构建结果与磁盘行尾无关
 * 防回归：autocrlf 环境下产物字节随 checkout 行尾浮动，跨环境 --check 假漂移
 */
test('mixed-eol sources build to a byte-stable artifact', () => {
  const normalize = (text) => text.replace(/\r\n/g, '\n');
  const expected = normalize(fs.readFileSync(dist, 'utf8'));
  const scripts = path.resolve(here, '../scripts');
  const sources = fs.readdirSync(scripts).filter((f) => f.endsWith('.mjs'));
  for (const mode of ['all-crlf', 'mixed-eol']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-eol-'));
    for (const f of sources) {
      const base = normalize(fs.readFileSync(path.join(scripts, f), 'utf8'));
      // 构建器自身除外：注入 `here` 让它读副本目录的模块源
      const source = f === 'build-viewer.mjs'
        ? base.replace('const here = path.dirname(fileURLToPath(import.meta.url));', `const here = ${JSON.stringify(dir)};`)
        : (mode === 'all-crlf'
          ? base.replace(/\n/g, '\r\n')
          : alternateEol(base));
      fs.writeFileSync(path.join(dir, f), source);
    }
    execFileSync(process.execPath, [path.join(dir, 'build-viewer.mjs')], { encoding: 'utf8' });
    // 构建器的产物目录相对注入的 `here` 解析：<dir>/../viewer-dist。
    const built = path.join(dir, '..', 'viewer-dist', 'view-memoery.js');
    assert.equal(normalize(fs.readFileSync(built, 'utf8')), expected, `${mode} 源构建的产物应与归一化基线一致`);
    // 产物本体必须是纯 LF：构建结果与磁盘行尾无关。
    assert.doesNotMatch(fs.readFileSync(built, 'utf8'), /\r\n/, '产物应全程 LF，无 CRLF');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Given：交付脚本复制到带空格的项目根，从另一 cwd 启动
 * When：读取快照
 * Then：读取项目根内的记忆而非 cwd 的记忆
 * 防回归：误操作其他项目的记忆
 */
test('script beside the store wins over the launch cwd, even with spaces', async () => {
  const spaced = fs.mkdtempSync(path.join(os.tmpdir(), 'psm spaced dir '));
  runCli(spaced, 'init');
  fs.writeFileSync(memory(spaced), store('0002') + record('0001', '带空格路径'));
  fs.copyFileSync(dist, path.join(spaced, 'view-memoery.js'));
  const elsewhere = temp();
  const child = spawn(process.execPath, [path.join(spaced, 'view-memoery.js'), '--no-open'], { cwd: elsewhere, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (c) => { out += c; const m = out.match(/PSM_VIEWER_URL: (\S+)/); if (m) resolve(m[1]); });
    child.on('exit', () => reject(Error(out)));
    setTimeout(() => reject(Error('timeout')), 15000);
  });
  try {
    const parsed = new URL(url);
    const res = await fetch(`http://127.0.0.1:${parsed.port}/api/snapshot`, { headers: { Authorization: `Bearer ${parsed.hash.replace('#token=', '')}` } });
    const snap = await res.json();
    assert.equal(snap.records[0].content, '带空格路径');
  } finally { child.kill(); }
});

/**
 * Given：项目里已存在旧独立查看器 view-memoery.js
 * When：新版 CLI 执行 init 与 viewer status
 * Then：init 不再部署也不改动旧查看器；旧查看器仍可自行启动并返回快照
 * 防回归：统一 preview 取代旧查看器时，把既有查看器删掉或弄坏
 */
test('legacy viewer survives the unified runtime rollout', async () => {
  const root = temp();
  runCli(root, 'init');
  const legacy = path.join(root, '.project-self-memory', 'view-memoery.js');
  fs.copyFileSync(dist, legacy);
  const before = fs.readFileSync(legacy);
  fs.writeFileSync(memory(root), store('0002') + record('0001', '旧查看器仍在'));

  // init 不部署也不覆盖旧查看器。
  runCli(root, 'init');
  assert.ok(fs.readFileSync(legacy).equals(before));

  // 旧查看器仍可独立运行。
  const child = spawn(process.execPath, [legacy, '--no-open'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(Error(`启动超时: ${out}`)), 15000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/PSM_VIEWER_URL: (\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on('exit', () => reject(Error(`提前退出: ${out}`)));
  });
  try {
    const parsed = new URL(url);
    const res = await fetch(`http://127.0.0.1:${parsed.port}/api/snapshot`, { headers: { Authorization: `Bearer ${parsed.hash.replace('#token=', '')}` } });
    const snap = await res.json();
    assert.equal(snap.records[0].content, '旧查看器仍在');
  } finally { child.kill(); }
});
