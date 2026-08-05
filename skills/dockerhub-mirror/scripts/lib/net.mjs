import dns from 'node:dns/promises';
import net from 'node:net';

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function inIpv4Range(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4]
    ].some(([base, bits]) => inIpv4Range(address, base, bits));
  }
  if (version === 6) {
    const value = address.toLowerCase();
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') ||
      value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') ||
      value.startsWith('2001:db8:');
  }
  return true;
}

export async function assertPublicUrl(input, { allowHttp = true } = {}) {
  const url = input instanceof URL ? input : new URL(input);
  if (!['https:', ...(allowHttp ? ['http:'] : [])].includes(url.protocol)) throw new Error(`Unsafe URL protocol: ${url.protocol}`);
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed.');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('Localhost is not allowed.');
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error(`Private or reserved IP is not allowed: ${hostname}`);
    return url;
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error(`DNS returned no addresses for ${hostname}`);
  for (const record of records) {
    if (isPrivateIp(record.address)) throw new Error(`Hostname ${hostname} resolves to private or reserved address ${record.address}`);
  }
  return url;
}

export function joinRegistryUrl(base, relativePath) {
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return new URL(relativePath.replace(/^\//, ''), normalized);
}

function combinedSignal(timeoutMs, parentSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  const onAbort = () => controller.abort(parentSignal.reason || new Error('Request aborted'));
  if (parentSignal) {
    if (parentSignal.aborted) onAbort();
    else parentSignal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
    }
  };
}

export async function fetchWithPolicy(input, options = {}) {
  const {
    timeoutMs = 8000,
    maxRedirects = 3,
    maxBytes = 2 * 1024 * 1024,
    validateUrl = true,
    signal: parentSignal,
    ...fetchOptions
  } = options;
  let current = input instanceof URL ? input : new URL(input);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    if (validateUrl) await assertPublicUrl(current);
    const timed = combinedSignal(timeoutMs, parentSignal);
    const started = performance.now();
    try {
      const response = await fetch(current, { ...fetchOptions, redirect: 'manual', signal: timed.signal });
      const elapsedMs = performance.now() - started;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Redirect ${response.status} without Location header.`);
        if (redirect === maxRedirects) throw new Error(`Too many redirects (>${maxRedirects}).`);
        current = new URL(location, current);
        continue;
      }
      const bytes = await readBodyLimited(response, maxBytes);
      return { response, bytes, elapsedMs, url: current };
    } finally {
      timed.cleanup();
    }
  }
  throw new Error('Unreachable redirect loop.');
}

export async function readBodyLimited(response, maxBytes) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function fetchStreamMetrics(input, options = {}) {
  const {
    timeoutMs = 8000,
    maxRedirects = 3,
    maxBytes = 1024 * 1024,
    validateUrl = true,
    signal: parentSignal,
    ...fetchOptions
  } = options;
  let current = input instanceof URL ? input : new URL(input);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    if (validateUrl) await assertPublicUrl(current);
    const timed = combinedSignal(timeoutMs, parentSignal);
    const started = performance.now();
    let response;
    try {
      response = await fetch(current, { ...fetchOptions, redirect: 'manual', signal: timed.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        timed.cleanup();
        if (!location) throw new Error(`Redirect ${response.status} without Location header.`);
        if (redirect === maxRedirects) throw new Error(`Too many redirects (>${maxRedirects}).`);
        current = new URL(location, current);
        continue;
      }
      if (!response.body) return { response, bytesRead: 0, ttfbMs: performance.now() - started, elapsedMs: performance.now() - started, url: current };
      const reader = response.body.getReader();
      let total = 0;
      let firstByteAt = null;
      while (total < maxBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        if (firstByteAt === null) firstByteAt = performance.now();
        total += value.byteLength;
        if (total >= maxBytes) {
          await reader.cancel();
          break;
        }
      }
      const ended = performance.now();
      return {
        response,
        bytesRead: Math.min(total, maxBytes),
        ttfbMs: (firstByteAt ?? ended) - started,
        elapsedMs: ended - started,
        url: current
      };
    } finally {
      timed.cleanup();
    }
  }
  throw new Error('Unreachable redirect loop.');
}

export function decodeUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}
