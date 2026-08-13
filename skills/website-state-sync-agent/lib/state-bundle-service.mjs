import { decodeText, encodeText, fromBase64, toBase64 } from './binary.mjs';
import { BUNDLE_FORMAT, FORMAT_VERSION, KDF_ITERATIONS } from './constants.mjs';

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function storageToObject(storage) {
  if (storage instanceof Map) return Object.fromEntries(storage);
  const values = {};
  for (let index = 0; index < storage.length; index += 1) values[storage.key(index)] = storage.getItem(storage.key(index));
  return values;
}

function domainMatches(domain, targetDomain) {
  const actual = String(domain || '').replace(/^\./, '').toLowerCase();
  const target = String(targetDomain || '').replace(/^\./, '').toLowerCase();
  return actual === target || actual.endsWith(`.${target}`);
}

function errorMessage(error, fallback) {
  if (typeof error === 'string' && error) return error;
  if (error?.message) return error.message;
  return fallback;
}

function normalizeSameSite(sameSite) {
  const value = String(sameSite || '').toLowerCase();
  if (!value || value === 'unspecified') return undefined;
  if (value === 'none' || value === 'no_restriction') return 'no_restriction';
  if (value === 'lax' || value === 'strict') return value;
  return null;
}

function createCookieSetDetails(cookie, source, target, { preserveOriginalHost = false } = {}) {
  const targetUrl = new URL(target.storageOrigin);
  const name = String(cookie.name || '');
  if (!name) return { reason: 'Cookie 缺少名称。' };
  if (!domainMatches(cookie.domain, source.cookieDomain)) return { reason: `Cookie 的来源域 ${cookie.domain || '(空)'} 不属于状态包来源域。` };
  if (cookie.partitionKey) return { reason: '分区 Cookie 不能安全迁移到新的站点。' };
  if (cookie.secure && targetUrl.protocol !== 'https:') return { reason: 'Secure Cookie 只能导入 HTTPS 目标。' };
  const sameSite = normalizeSameSite(cookie.sameSite);
  if (sameSite === null) return { reason: `SameSite=${cookie.sameSite} 不受目标浏览器 API 支持。` };
  if (sameSite === 'no_restriction' && !cookie.secure) return { reason: 'SameSite=None Cookie 必须同时启用 Secure。' };
  if (name.startsWith('__Secure-') && !cookie.secure) return { reason: '__Secure- Cookie 必须启用 Secure。' };
  if (name.startsWith('__Host-') && (!cookie.secure || cookie.path !== '/')) return { reason: '__Host- Cookie 必须启用 Secure 且 Path 为 /。' };
  const expirationDate = cookie.expirationDate ?? cookie.expires;
  if (expirationDate !== undefined && (!Number.isFinite(expirationDate) || expirationDate <= 0)) return { reason: 'Cookie 过期时间无效。' };
  const path = cookie.path?.startsWith('/') ? cookie.path : '/';
  let url = targetUrl.origin;
  if (preserveOriginalHost) {
    const host = String(cookie.domain || '').replace(/^\./, '');
    if (!host) return { reason: 'Cookie 缺少来源主机。' };
    targetUrl.hostname = host;
    targetUrl.pathname = path;
    targetUrl.search = '';
    targetUrl.hash = '';
    url = targetUrl.toString();
  }
  const details = { name, value: String(cookie.value ?? ''), url, path };
  if (preserveOriginalHost && cookie.hostOnly === false && cookie.domain) details.domain = cookie.domain;
  if (expirationDate !== undefined) details.expirationDate = expirationDate;
  if (cookie.secure) details.secure = true;
  if (cookie.httpOnly) details.httpOnly = true;
  if (sameSite) details.sameSite = sameSite;
  return { details };
}

async function deriveKey(password, salt, crypto) {
  const passwordKey = await crypto.subtle.importKey('raw', encodeText(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function validateDecodedBundle(bundle) {
  if (!bundle || bundle.format !== BUNDLE_FORMAT || !Number.isInteger(bundle.version)) throw new Error('状态包格式无效。');
  if (bundle.version !== FORMAT_VERSION) throw new Error(`不支持的状态包格式版本：${bundle.version}。`);
  const { payload } = bundle;
  if (!isRecord(payload) || !isRecord(payload.source) || typeof payload.source.cookieDomain !== 'string' || !payload.source.cookieDomain || typeof payload.source.storageOrigin !== 'string' || !Array.isArray(payload.cookies) || !isRecord(payload.storage) || !isRecord(payload.storage.local) || !isRecord(payload.storage.session)) throw new Error('状态包缺少必要的状态数据。');
  try { new URL(payload.source.storageOrigin); }
  catch { throw new Error('状态包中的 Web Storage origin 无效。'); }
  return bundle;
}

export async function decodeStateBundle(bundle, password, crypto) {
  if (!bundle || bundle.format !== BUNDLE_FORMAT || !Number.isInteger(bundle.version)) throw new Error('状态包格式无效。');
  if (bundle.version !== FORMAT_VERSION) throw new Error(`不支持的状态包格式版本：${bundle.version}。`);
  if (!bundle.encrypted) return validateDecodedBundle(bundle);
  if (!password) throw new Error('此加密状态包需要状态包密码。');
  if (!bundle.kdf || bundle.kdf.name !== 'PBKDF2' || bundle.kdf.hash !== 'SHA-256' || bundle.kdf.iterations !== KDF_ITERATIONS || !bundle.encryption || bundle.encryption.name !== 'AES-GCM' || bundle.encryption.algorithm !== 'AES-256-GCM' || typeof bundle.kdf.salt !== 'string' || typeof bundle.encryption.iv !== 'string' || typeof bundle.ciphertext !== 'string') throw new Error('状态包加密规范不兼容。');
  let salt; let iv; let ciphertext;
  try { salt = fromBase64(bundle.kdf.salt); iv = fromBase64(bundle.encryption.iv); ciphertext = fromBase64(bundle.ciphertext); }
  catch { throw new Error('状态包加密载荷无效。'); }
  if (salt.length !== 16 || iv.length !== 12) throw new Error('状态包加密载荷长度不兼容。');
  try {
    const key = await deriveKey(password, salt, crypto);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return validateDecodedBundle({ format: bundle.format, version: bundle.version, encrypted: true, payload: JSON.parse(decodeText(plaintext)) });
  } catch (error) { throw new Error('状态包密码错误、密文已损坏或格式不兼容。', { cause: error }); }
}

export async function exportStateBundle({ adapter, source, password, encrypt = true, randomValues }) {
  if (!source?.cookieDomain || !source?.storageOrigin) throw new Error('导出需要 Cookie 注册域和当前 origin。');
  if (encrypt && !password) throw new Error('加密状态包需要状态包密码。');
  const payload = { source: { cookieDomain: source.cookieDomain, storageOrigin: source.storageOrigin }, exportedAt: new Date().toISOString(), cookies: await adapter.listCookies(source.cookieDomain), storage: { local: storageToObject(adapter.getStorage('local')), session: storageToObject(adapter.getStorage('session')) } };
  if (!encrypt) return { format: BUNDLE_FORMAT, version: FORMAT_VERSION, encrypted: false, payload };
  const random = randomValues || ((length) => adapter.crypto.getRandomValues(new Uint8Array(length)));
  const salt = random(16); const iv = random(12);
  const key = await deriveKey(password, salt, adapter.crypto);
  const ciphertext = await adapter.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodeText(JSON.stringify(payload)));
  return { format: BUNDLE_FORMAT, version: FORMAT_VERSION, encrypted: true, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: toBase64(salt) }, encryption: { name: 'AES-GCM', algorithm: 'AES-256-GCM', iv: toBase64(iv) }, ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export async function preflightImport({ adapter, bundle, password, target, mappingConfirmed = false }) {
  try {
    const decoded = await decodeStateBundle(bundle, password, adapter.crypto);
    if (!target?.cookieDomain || !target?.storageOrigin) return { ok: false, errors: ['请填写 Cookie 注册域目标和 Web Storage origin 目标。'] };
    try { new URL(target.storageOrigin); } catch { return { ok: false, errors: ['Web Storage origin 目标无效。'] }; }
    const mapped = decoded.payload.source.cookieDomain !== target.cookieDomain || decoded.payload.source.storageOrigin !== target.storageOrigin;
    if (mapped && !mappingConfirmed) return { ok: false, errors: ['目标映射导入必须在写入前由用户明确确认。'], decoded };
    const cookiePlan = [];
    const skipped = [];
    for (const cookie of decoded.payload.cookies) {
      const plan = createCookieSetDetails(cookie, decoded.payload.source, target, { preserveOriginalHost: !mapped });
      if (plan.reason) { skipped.push({ type: 'cookie', name: cookie.name || '(无名称)', reason: plan.reason }); continue; }
      if (adapter.canWriteCookie && !(await adapter.canWriteCookie(plan.details, target.cookieDomain))) { skipped.push({ type: 'cookie', name: cookie.name, reason: 'ScriptCat 没有目标域的 Cookie 写入授权。' }); continue; }
      cookiePlan.push({ name: cookie.name, details: plan.details });
    }
    return { ok: true, errors: [], decoded, mapped, target, cookiePlan, skipped };
  } catch (error) { return { ok: false, errors: [error.message] }; }
}

function clearStorage(storage) { storage.clear(); }
function writeStorage(storage, values) { for (const [key, value] of Object.entries(values)) storage instanceof Map ? storage.set(key, String(value)) : storage.setItem(key, String(value)); }

export async function applyImport({ adapter, preflight, mode = 'merge', scope = { cookies: true, local: true, session: true } }) {
  if (!preflight?.ok) return { ok: false, errors: ['导入预检未通过；未进行任何写入。'], succeeded: [], failed: [], skipped: [] };
  if (!['merge', 'replace'].includes(mode)) return { ok: false, errors: ['未知的导入模式。'], succeeded: [], failed: [], skipped: [] };
  const { payload } = preflight.decoded; const succeeded = []; const failed = []; const skipped = scope.cookies ? [...(preflight.skipped || [])] : [];
  if (mode === 'replace') {
    for (const [enabled, type, operation] of [[scope.cookies, 'cookies-cleared', () => adapter.clearCookies(preflight.target.cookieDomain)], [scope.local, 'localStorage-cleared', () => clearStorage(adapter.getStorage('local'))], [scope.session, 'sessionStorage-cleared', () => clearStorage(adapter.getStorage('session'))]]) {
      if (!enabled) continue;
      try { await operation(); succeeded.push({ type }); } catch (error) { failed.push({ type, error: errorMessage(error, `无法清空 ${type}。`) }); }
    }
  }
  if (scope.cookies) for (const cookie of preflight.cookiePlan || payload.cookies.map((item) => ({ name: item.name, details: item }))) {
    try { await adapter.setCookie(cookie.details); succeeded.push({ type: 'cookie', name: cookie.name }); } catch (error) { failed.push({ type: 'cookie', name: cookie.name, error: errorMessage(error, '浏览器拒绝写入 Cookie，但未返回详细原因。') }); }
  }
  for (const [enabled, kind, values] of [[scope.local, 'localStorage', payload.storage.local], [scope.session, 'sessionStorage', payload.storage.session]]) {
    if (!enabled) continue;
    try { writeStorage(adapter.getStorage(kind === 'localStorage' ? 'local' : 'session'), values); succeeded.push({ type: kind, count: Object.keys(values).length }); } catch (error) { failed.push({ type: kind, error: errorMessage(error, `无法写入 ${kind}。`) }); }
  }
  return { ok: true, succeeded, failed, skipped, errors: [] };
}

export { BUNDLE_FORMAT, FORMAT_VERSION, KDF_ITERATIONS };
