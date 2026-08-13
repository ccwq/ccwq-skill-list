import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import * as service from '../lib/state-bundle-service.mjs';
import { configuredCdpUrls, withPageCdp } from './cdp-client.mjs';
import { planCdpCookies, resolveImportTargetUrl } from './cdp-state-transfer.mjs';

const PASSWORD_KEY = 'WEBSET_STATE_SYNC_PASSWORD';
const OUTPUT_DIR = '.website-state-sync-agent';

function getPassword() { return process.env[PASSWORD_KEY] || '1599'; }

function fail(message) { process.stderr.write(`${message}\n`); process.exitCode = 1; }

function parseArgs(args) {
  const [action, ...rest] = args;
  if (!['export', 'import', 'sync'].includes(action)) throw new Error('用法：state-sync.mjs export|import|sync ...');
  if (action === 'sync') {
    const sourceUrlIndex = rest.indexOf('--source-url');
    const targetUrlIndex = rest.indexOf('--target-url');
    if (sourceUrlIndex < 0 || targetUrlIndex < 0 || !rest[sourceUrlIndex + 1] || !rest[targetUrlIndex + 1]) throw new Error('同步需要 --source-url <URL> 和 --target-url <URL>。');
    const sourceCdpIndex = rest.indexOf('--source-cdp');
    const targetCdpIndex = rest.indexOf('--target-cdp');
    const sourceUrl = rest[sourceUrlIndex + 1]; const targetUrl = rest[targetUrlIndex + 1];
    const sourceCdp = sourceCdpIndex >= 0 ? [rest[sourceCdpIndex + 1]] : configuredCdpUrls();
    const targetCdp = targetCdpIndex >= 0 ? [rest[targetCdpIndex + 1]] : configuredCdpUrls();
    new URL(sourceUrl); new URL(targetUrl);
    return { action, sourceUrl, targetUrl, sourceCdp, targetCdp };
  }
  const urlIndex = rest.indexOf('--url');
  if (urlIndex < 0 || !rest[urlIndex + 1] || urlIndex !== rest.length - 2) throw new Error('每次操作都必须以 --url <当前已打开页面 URL> 动态提供目标页面。');
  const url = rest[urlIndex + 1];
  try { new URL(url); } catch { throw new Error(`--url 不是有效 URL：${url}`); }
  const inputArgs = rest.slice(0, urlIndex);
  if (action === 'export' && inputArgs.length) throw new Error('导出仅接受 --url。');
  if (action === 'import' && (!inputArgs.length || inputArgs.length > 2 || (inputArgs.length === 2 && inputArgs[0] !== '--text'))) throw new Error('导入需要一个文件路径，或 --text <JSON>。');
  return { action, url, input: action === 'import' ? (inputArgs[0] === '--text' ? inputArgs[1] : readFileSync(resolve(inputArgs[0]), 'utf8')) : undefined, source: action === 'import' && inputArgs[0] !== '--text' ? resolve(inputArgs[0]) : 'text' };
}

function uniqueOutputPath(cwd) {
  const directory = join(cwd, OUTPUT_DIR);
  mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let counter = 0;
  while (true) {
    const suffix = counter ? `-${counter}` : '';
    const candidate = join(directory, `site-state-bundle-${stamp}${suffix}.json`);
    if (!existsSync(candidate)) return candidate;
    counter += 1;
  }
}

async function exportWithCdp(url, password, cdpUrls) {
  return withPageCdp(url, async (cdp) => {
    await cdp.send('Network.enable');
    const { cookies } = await cdp.send('Network.getCookies', { urls: [url] });
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index), localStorage.getItem(localStorage.key(index))])),
        session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index), sessionStorage.getItem(sessionStorage.key(index))])),
      })`,
      returnByValue: true,
    });
    if (evaluated.exceptionDetails) throw new Error(`CDP 无法读取 Web Storage：${evaluated.exceptionDetails.text || 'Runtime.evaluate failed'}`);
    const storage = JSON.parse(evaluated.result.value || '{}');
    const pageUrl = new URL(url);
    const adapter = {
      crypto: globalThis.crypto || webcrypto,
      async listCookies() { return cookies; },
      getStorage(kind) { return new Map(Object.entries(storage[kind] || {})); },
    };
    return service.exportStateBundle({
      adapter,
      source: { cookieDomain: pageUrl.hostname, storageOrigin: pageUrl.origin },
      password,
      encrypt: true,
    });
  }, { cdpUrls });
}

async function importWithCdp({ bundle, password, targetUrl, cdpUrls }) {
  const decoded = await service.decodeStateBundle(bundle, password, globalThis.crypto || webcrypto);
  const source = decoded.payload.source;
  const target = new URL(targetUrl);
  if (source.cookieDomain !== target.hostname || source.storageOrigin !== target.origin) throw new Error('CDP 自动导入只允许同一 Cookie 域和同一 origin；跨站状态转移必须另行明确确认。');
  const resolvedTargetUrl = resolveImportTargetUrl(bundle, targetUrl);
  return withPageCdp(resolvedTargetUrl, async (cdp) => {
    await cdp.send('Network.enable');
    const cookiePlan = planCdpCookies(decoded.payload.cookies, resolvedTargetUrl);
    if (cookiePlan.writable.length) await cdp.send('Network.setCookies', { cookies: cookiePlan.writable });
    const values = JSON.stringify(decoded.payload.storage);
    const written = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const state = ${values}; for (const [key, value] of Object.entries(state.local)) localStorage.setItem(key, String(value)); for (const [key, value] of Object.entries(state.session)) sessionStorage.setItem(key, String(value)); return JSON.stringify({ local: Object.keys(state.local).length, session: Object.keys(state.session).length }); })()`,
      returnByValue: true,
    });
    if (written.exceptionDetails) throw new Error(`CDP 无法写入 Web Storage：${written.exceptionDetails.text || 'Runtime.evaluate failed'}`);
    const counts = JSON.parse(written.result.value || '{}');
    await cdp.send('Page.navigate', { url: resolvedTargetUrl });
    return { cookies: cookiePlan.writable.length, skippedCookies: cookiePlan.skipped, local: counts.local || 0, session: counts.session || 0, navigated: resolvedTargetUrl };
  }, { cdpUrls });
}

async function syncWithCdp({ sourceUrl, targetUrl, password, sourceCdp, targetCdp }) {
  const bundle = await exportWithCdp(sourceUrl, password, sourceCdp);
  return importWithCdp({ bundle, password, targetUrl, cdpUrls: targetCdp });
}

try {
  const cwd = process.cwd();
  const password = getPassword();
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.action === 'sync') {
    const result = await syncWithCdp({ ...parsed, password });
    process.stdout.write(`同步完成：Cookie ${result.cookies} 项，localStorage ${result.local} 项，sessionStorage ${result.session} 项，跳过 Cookie ${result.skippedCookies.length} 项。\n`);
    for (const skipped of result.skippedCookies) process.stdout.write(`跳过：${skipped.name} - ${skipped.reason}\n`);
    process.exit(0);
  }
  const { action, url, input, source } = parsed;
  let bundle;
  if (action === 'import') {
    try { bundle = JSON.parse(input); } catch { throw new Error(`导入内容不是有效 JSON（来源：${source}）。`); }
    if (!bundle?.encrypted) throw new Error('自动导入仅接受 encrypted: true 的状态包。');
  }
  if (action === 'export') {
    const result = await exportWithCdp(url, password, configuredCdpUrls({ cwd }));
    if (!result?.encrypted) throw new Error('浏览器未返回加密状态包，已拒绝写出。');
    const outputPath = uniqueOutputPath(cwd);
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`导出完成：${outputPath}\n加密：AES-256-GCM\n`);
  } else {
    const result = await importWithCdp({ bundle, password, targetUrl: url, cdpUrls: configuredCdpUrls({ cwd }) });
    process.stdout.write(`导入完成：Cookie ${result.cookies} 项，localStorage ${result.local} 项，sessionStorage ${result.session} 项，跳过 Cookie ${result.skippedCookies.length} 项。\n`);
    for (const skipped of result.skippedCookies) process.stdout.write(`跳过：${skipped.name} - ${skipped.reason}\n`);
  }
} catch (error) { fail(error.message); }
