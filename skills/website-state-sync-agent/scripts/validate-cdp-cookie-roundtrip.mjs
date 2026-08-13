import { createServer } from 'node:http';
import { configuredCdpUrls, withPageCdp } from './cdp-client.mjs';

function startServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>CDP cookie validation</title><script>localStorage.setItem("cdp-validation", "ok")</script>');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const [validationCdpUrl] = configuredCdpUrls();
function cdpHttpUrl(path) { return new URL(path, validationCdpUrl); }

async function createTarget(url) {
  const version = await (await fetch(cdpHttpUrl('/json/version'))).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('无法连接 browser CDP。')), { once: true });
  });
  const result = await new Promise((resolve, reject) => {
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id === 1) message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
    socket.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url } }));
  });
  return { socket, targetId: result.targetId };
}

async function closeTarget(socket, targetId) {
  socket.send(JSON.stringify({ id: 2, method: 'Target.closeTarget', params: { targetId } }));
  socket.close();
}

const server = await startServer();
const origin = `http://127.0.0.1:${server.address().port}`;
const cookieName = `website_state_sync_probe_${Date.now()}`;
let target;

try {
  target = await createTarget(origin);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await withPageCdp(`${origin}/`, async (cdp) => {
    await cdp.send('Network.enable');
    const write = await cdp.send('Network.setCookie', { name: cookieName, value: 'probe-value-not-logged', url: `${origin}/`, httpOnly: true, sameSite: 'Lax' });
    if (!write.success) throw new Error('CDP 未接受 HttpOnly 测试 Cookie。');
    const scoped = await cdp.send('Network.getCookies', { urls: [`${origin}/`] });
    const cookie = scoped.cookies.find((item) => item.name === cookieName);
    if (!cookie?.httpOnly) throw new Error('CDP 未读取到 HttpOnly 测试 Cookie。');
    const storage = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify({local: localStorage.getItem("cdp-validation"), session: sessionStorage.length})', returnByValue: true });
    const storageValue = JSON.parse(storage.result.value);
    if (storageValue.local !== 'ok') throw new Error('CDP 未读取到同页 localStorage。');
    await cdp.send('Network.deleteCookies', { name: cookieName, url: `${origin}/` });
    const afterDelete = await cdp.send('Network.getCookies', { urls: [`${origin}/`] });
    if (afterDelete.cookies.some((item) => item.name === cookieName)) throw new Error('CDP 未清理 HttpOnly 测试 Cookie。');
  });
  process.stdout.write('CDP_HTTPONLY_ROUNDTRIP_VALID: write/read/delete + localStorage passed; no cookie values logged.\n');
} finally {
  if (target) await closeTarget(target.socket, target.targetId);
  await new Promise((resolve) => server.close(resolve));
}
