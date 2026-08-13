const CDP_URLS_KEY = 'WEBSET_STATE_SYNC_CDP_URLS';
const CDP_URL_KEY = 'WEBSET_STATE_SYNC_CDP_URL';
const CHROME_PATH_KEY = 'WEBSET_STATE_SYNC_CHROME_PATH';

export function parseCdpUrls(value) {
  const candidates = String(value || '').split(/[\s,]+/).filter(Boolean);
  const urls = candidates.map((candidate) => {
    const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol) || !url.host) throw new Error(`CDP 地址无效：${candidate}`);
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  });
  if (!urls.length) throw new Error(`未设置 ${CDP_URLS_KEY} 或 ${CDP_URL_KEY} 环境变量。`);
  return [...new Set(urls)];
}

/** 从环境变量读取一个或多个 CDP 地址。 */
export function configuredCdpUrls({ env = process.env } = {}) {
  const raw = env[CDP_URLS_KEY] || env[CDP_URL_KEY];
  return parseCdpUrls(raw);
}

/** 从环境变量读取隔离 Chrome 可执行文件路径。 */
export function configuredChromePath({ env = process.env } = {}) {
  return env[CHROME_PATH_KEY] || '';
}

function cdpHttpUrl(cdpUrl, path) {
  const base = new URL(cdpUrl);
  base.pathname = path;
  base.search = '';
  return base;
}

async function readJson(cdpUrl, path) {
  const response = await fetch(cdpHttpUrl(cdpUrl, path));
  if (!response.ok) throw new Error(`CDP ${path} 请求失败：HTTP ${response.status}`);
  return response.json();
}

class CdpConnection {
  #socket;
  #sequence = 0;
  #pending = new Map();

  constructor(webSocketUrl, commandTimeoutMs = 10_000) { this.webSocketUrl = webSocketUrl; this.commandTimeoutMs = commandTimeoutMs; }

  async connect() {
    this.#socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接 CDP WebSocket 超时。')), 10_000);
      this.#socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.#socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接 CDP WebSocket。')); }, { once: true });
    });
    this.#socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      message.error ? pending.reject(new Error(`CDP ${pending.method} 失败：${message.error.message}`)) : pending.resolve(message.result);
    });
    this.#socket.addEventListener('close', () => {
      for (const pending of this.#pending.values()) pending.reject(new Error('CDP WebSocket 已关闭。'));
      this.#pending.clear();
    });
    return this;
  }

  send(method, params = {}) {
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP 命令超时：${method}`));
      }, this.commandTimeoutMs);
      this.#pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); }, method });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.#socket?.close(); }
}

export async function findPageTarget(url, { cdpUrls = configuredCdpUrls() } = {}) {
  const requested = new URL(url);
  const failures = [];
  for (const cdpUrl of cdpUrls) {
    try {
      const targets = await readJson(cdpUrl, '/json/list');
      const target = targets.find((item) => {
        if (item.type !== 'page') return false;
        try { return new URL(item.url).href === requested.href || new URL(item.url).origin === requested.origin; }
        catch { return false; }
      });
      if (target?.webSocketDebuggerUrl) {
        const websocket = new URL(target.webSocketDebuggerUrl);
        const endpoint = new URL(cdpUrl);
        if (['0.0.0.0', '127.0.0.1', 'localhost'].includes(websocket.hostname)) websocket.hostname = endpoint.hostname;
        if (!websocket.port) websocket.port = endpoint.port;
        return { ...target, webSocketDebuggerUrl: websocket.toString(), cdpUrl };
      }
      failures.push(`${cdpUrl}：未打开目标页面`);
    } catch (error) { failures.push(`${cdpUrl}：${error.message}`); }
  }
  throw new Error(`未在已配置 CDP 中找到目标页面：${url}。${failures.join('；')}`);
}

export async function withPageCdp(url, callback, options = {}) {
  const target = await findPageTarget(url, options);
  const connection = await new CdpConnection(target.webSocketDebuggerUrl, options.commandTimeoutMs ?? 10_000).connect();
  try { return await callback(connection, target); }
  finally { connection.close(); }
}

/** 将可观察错误映射到同步阶段，供重试策略与脱敏摘要复用。 */
export function classifyCdpFailure(error) {
  const message = String(error?.message || error || '');
  if (/fetch failed|\/json\/(version|list)|未在已配置 CDP 中找到目标页面/i.test(message)) return 'discovery';
  if (/WebSocket|无法连接 CDP|连接 CDP/i.test(message)) return 'websocket';
  if (/Runtime\.evaluate|Runtime|页面运行时/i.test(message)) return 'runtime';
  if (/Network\.(setCookie|setCookies)|写入 Cookie|Storage\.setCookies/i.test(message)) return 'write';
  return 'unknown';
}

export { CDP_URLS_KEY, CDP_URL_KEY, CHROME_PATH_KEY };
