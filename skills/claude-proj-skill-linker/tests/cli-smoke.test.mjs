import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDirectExecution } from '../scripts/link-skills.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/link-skills.mjs', import.meta.url));

async function makeProject(t, names = ['alpha']) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linker-cli-smoke-含空格-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  for (const name of names) {
    const skillDir = path.join(root, '.agents', 'skills', name);
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  }
  await fsp.mkdir(path.join(root, '.claude', 'skills'), { recursive: true });
  return root;
}

function runCli(root, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, '--project-root', root, ...args], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    windowsHide: true,
  });
}

function parseSingleJson(stdout) {
  assert.notEqual(stdout.trim(), '', 'stdout should contain a JSON report');
  const report = JSON.parse(stdout);
  assert.equal(stdout.trim(), JSON.stringify(report, null, 2));
  return report;
}

function assertLinkReadable(root, name) {
  const entry = path.join(root, '.claude', 'skills', name);
  assert.equal(fs.lstatSync(entry).isSymbolicLink(), true);
  assert.match(fs.readFileSync(path.join(entry, 'SKILL.md'), 'utf8'), /name:/);
}

test('CLI path comparison normalizes file URLs, relative paths, and missing argv values', () => {
  /**
   * Given：入口路径可能来自相对路径、文件 URL 或编码后的 Windows 路径
   * When：比较 argv[1] 与 import.meta.url 的等价表示
   * Then：同一脚本的路径形态均识别为直接执行，缺失 argv[1] 不触发
   * 防回归：避免 Windows 盘符大小写、分隔符或 URL 编码导致静默 exit 0
   */
  const moduleUrl = pathToFileURL(SCRIPT_PATH).href;
  assert.equal(isDirectExecution(SCRIPT_PATH, moduleUrl), true);
  assert.equal(isDirectExecution(path.relative(process.cwd(), SCRIPT_PATH), moduleUrl), true);
  assert.equal(isDirectExecution(moduleUrl, moduleUrl), true);
  assert.equal(isDirectExecution(undefined, moduleUrl), false);
  assert.equal(isDirectExecution(path.join(path.dirname(SCRIPT_PATH), 'other.mjs'), moduleUrl), false);
});

test('CLI preview emits one JSON report and no diagnostics', async (t) => {
  /**
   * Given：临时项目中存在一个实体源 skill，且从不同 cwd 启动真实 CLI
   * When：执行默认 preview
   * Then：exit 0、stdout 是单个 JSON 报告、stderr 为空且提出 link action
   * 防回归：锁定脚本必须进入 main，禁止无输出的假成功
   */
  const root = await makeProject(t);
  const result = runCli(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = parseSingleJson(result.stdout);
  assert.equal(report.mode, 'preview');
  assert.equal(report.root, path.resolve(root));
  assert.equal(report.actionCount, 1);
  assert.equal(report.items[0].action, 'link');
});

test('CLI apply verifies the filesystem and preview becomes idempotent', async (t) => {
  /**
   * Given：preview 已输出当前项目的 digest
   * When：通过独立 CLI 进程执行 --apply --expect
   * Then：exit 0、报告含 results，入口为链接且经入口可读 SKILL.md，复扫 actionCount 为 0
   * 防回归：避免函数层成功但文件系统入口实际不可用
   */
  const root = await makeProject(t);
  const preview = runCli(root);
  const previewReport = parseSingleJson(preview.stdout);
  const applied = runCli(root, ['--apply', '--expect', previewReport.digest]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.stderr, '');
  const report = parseSingleJson(applied.stdout);
  assert.equal(report.mode, 'apply');
  assert.deepEqual(report.results, [{ name: 'alpha', action: 'link', status: 'ok' }]);
  assertLinkReadable(root, 'alpha');

  const second = runCli(root);
  const secondReport = parseSingleJson(second.stdout);
  assert.equal(secondReport.actionCount, 0);
  assert.equal(secondReport.items[0].note, 'already linked correctly; nothing to do');
});

test('CLI no-action preview still emits a JSON report', async (t) => {
  /**
   * Given：项目入口已经是 canonical link
   * When：再次执行 preview
   * Then：exit 0、stdout 有 JSON 且 actionCount 为 0，stderr 为空
   * 防回归：区分正常无 action 与脚本未运行的静默结果
   */
  const root = await makeProject(t);
  const first = runCli(root);
  const digest = parseSingleJson(first.stdout).digest;
  const applied = runCli(root, ['--apply', '--expect', digest]);
  assert.equal(applied.status, 0, applied.stderr);
  const result = runCli(root);
  const report = parseSingleJson(result.stdout);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(report.actionCount, 0);
});

test('CLI help and usage errors have deterministic channels', async (t) => {
  /**
   * Given：CLI 分别收到帮助请求和缺少必需值的参数
   * When：启动两个独立子进程
   * Then：help 为 stdout/exit 0，参数错误为 stderr/exit 2 且 stdout 为空
   * 防回归：让脚本调用方可靠区分帮助、用法错误和业务失败
   */
  const root = await makeProject(t);
  const help = spawnSync(process.execPath, [SCRIPT_PATH, '--help'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage:/);
  assert.equal(help.stderr, '');

  const usage = runCli(root, ['--apply']);
  assert.equal(usage.status, 2);
  assert.equal(usage.stdout, '');
  assert.match(usage.stderr, /--apply requires --expect/);
});

test('CLI runtime failure reports ERROR and never claims success', async (t) => {
  /**
   * Given：preview 后项目状态发生变化
   * When：使用过期 digest 通过 CLI apply
   * Then：exit 非 0、stdout 为空、stderr 以 ERROR STALE 开头且不创建入口
   * 防回归：避免自动化流程把状态漂移当作成功继续执行
   */
  const root = await makeProject(t);
  const preview = runCli(root);
  const digest = parseSingleJson(preview.stdout).digest;
  await fsp.mkdir(path.join(root, '.agents', 'skills', 'new-skill'), { recursive: true });
  await fsp.writeFile(path.join(root, '.agents', 'skills', 'new-skill', 'SKILL.md'), 'new');
  const result = runCli(root, ['--apply', '--expect', digest]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^ERROR STALE:/);
  assert.equal(fs.existsSync(path.join(root, '.claude', 'skills', 'alpha')), false);
});

test('importing the CLI module does not run main', () => {
  /**
   * Given：脚本作为模块被 embedding 调用而非作为 CLI 入口
   * When：子进程 import 该模块
   * Then：无 stdout/stderr 且 exit 0
   * 防回归：argv[1] 缺失或形态异常时不能误执行或抛出 ESM URL scheme 错误
   */
  const scriptUrl = pathToFileURL(SCRIPT_PATH).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(scriptUrl)})`], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
