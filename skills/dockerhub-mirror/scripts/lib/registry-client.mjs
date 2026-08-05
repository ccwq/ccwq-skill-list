import { fetchWithPolicy, fetchStreamMetrics, joinRegistryUrl, decodeUtf8 } from './net.mjs';

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json'
].join(', ');

export function parseBearerChallenge(header) {
  if (!header || !/^Bearer\s+/i.test(header)) return null;
  const params = {};
  const body = header.replace(/^Bearer\s+/i, '');
  const regex = /([a-zA-Z][\w-]*)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(body))) params[match[1].toLowerCase()] = match[2];
  if (!params.realm) return null;
  return params;
}

export class RegistryClient {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl;
    this.options = options;
    this.tokens = new Map();
  }

  async getToken(challenge, scope) {
    const effectiveScope = challenge.scope || scope || '';
    const key = `${challenge.realm}|${challenge.service || ''}|${effectiveScope}`;
    if (this.tokens.has(key)) return this.tokens.get(key);
    const tokenUrl = new URL(challenge.realm);
    if (challenge.service) tokenUrl.searchParams.set('service', challenge.service);
    if (effectiveScope) tokenUrl.searchParams.set('scope', effectiveScope);
    const result = await fetchWithPolicy(tokenUrl, {
      timeoutMs: this.options.requestTimeoutMs,
      maxRedirects: this.options.maxRedirects,
      maxBytes: 1024 * 1024,
      headers: { Accept: 'application/json' },
      validateUrl: !this.options.allowPrivateTestTargets
    });
    if (!result.response.ok) throw new Error(`Token service returned HTTP ${result.response.status}`);
    const payload = JSON.parse(decodeUtf8(result.bytes));
    const token = payload.token || payload.access_token;
    if (!token) throw new Error('Token service response did not contain a token.');
    this.tokens.set(key, token);
    return token;
  }

  async request(relativePath, { repository, headers = {}, maxBytes, method = 'GET' } = {}) {
    const url = joinRegistryUrl(this.baseUrl, relativePath);
    const baseOptions = {
      method,
      timeoutMs: this.options.requestTimeoutMs,
      maxRedirects: this.options.maxRedirects,
      maxBytes: maxBytes ?? this.options.maxManifestBytes,
      headers,
      validateUrl: !this.options.allowPrivateTestTargets
    };
    let result = await fetchWithPolicy(url, baseOptions);
    if (result.response.status !== 401) return result;
    const challenge = parseBearerChallenge(result.response.headers.get('www-authenticate'));
    if (!challenge) return result;
    const scope = repository ? `repository:${repository}:pull` : undefined;
    const token = await this.getToken(challenge, scope);
    return fetchWithPolicy(url, { ...baseOptions, headers: { ...headers, Authorization: `Bearer ${token}` } });
  }

  async requestStream(relativePath, { repository, headers = {}, maxBytes } = {}) {
    const url = joinRegistryUrl(this.baseUrl, relativePath);
    const baseOptions = {
      timeoutMs: this.options.requestTimeoutMs,
      maxRedirects: this.options.maxRedirects,
      maxBytes: maxBytes ?? this.options.maxBlobBytes,
      headers,
      validateUrl: !this.options.allowPrivateTestTargets
    };
    let result = await fetchStreamMetrics(url, baseOptions);
    if (result.response.status !== 401) return result;
    const challenge = parseBearerChallenge(result.response.headers.get('www-authenticate'));
    if (!challenge) return result;
    const scope = repository ? `repository:${repository}:pull` : undefined;
    const token = await this.getToken(challenge, scope);
    return fetchStreamMetrics(url, { ...baseOptions, headers: { ...headers, Authorization: `Bearer ${token}` } });
  }

  async probeApi() {
    const result = await this.request('v2/', { maxBytes: 64 * 1024 });
    const challenge = parseBearerChallenge(result.response.headers.get('www-authenticate'));
    const ok = result.response.status === 200 || (result.response.status === 401 && Boolean(challenge));
    return { ok, status: result.response.status, elapsedMs: result.elapsedMs, challenge: Boolean(challenge) };
  }

  async getManifest(repository, reference) {
    const result = await this.request(`v2/${repository}/manifests/${encodeURIComponent(reference)}`, {
      repository,
      maxBytes: this.options.maxManifestBytes,
      headers: { Accept: MANIFEST_ACCEPT }
    });
    if (!result.response.ok) throw new Error(`Manifest request returned HTTP ${result.response.status}`);
    const mediaType = result.response.headers.get('content-type')?.split(';')[0] || '';
    const manifest = JSON.parse(decodeUtf8(result.bytes));
    return { manifest, mediaType, elapsedMs: result.elapsedMs, digest: result.response.headers.get('docker-content-digest') };
  }

  async getBlobMetrics(repository, digest) {
    const result = await this.requestStream(`v2/${repository}/blobs/${encodeURIComponent(digest)}`, {
      repository,
      maxBytes: this.options.maxBlobBytes,
      headers: { Range: `bytes=0-${this.options.maxBlobBytes - 1}` }
    });
    if (![200, 206].includes(result.response.status)) throw new Error(`Blob request returned HTTP ${result.response.status}`);
    const transferMs = Math.max(1, result.elapsedMs - result.ttfbMs);
    const throughputKibS = (result.bytesRead / 1024) / (transferMs / 1000);
    return { ...result, throughputKibS };
  }
}

export function selectPlatformManifest(index) {
  const architectureMap = { x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: '386' };
  const wantedArch = architectureMap[process.arch] || process.arch;
  const wantedOs = process.platform === 'win32' ? 'windows' : 'linux';
  return index.manifests?.find((entry) => entry.platform?.os === wantedOs && entry.platform?.architecture === wantedArch)
    || index.manifests?.find((entry) => entry.platform?.os === 'linux' && entry.platform?.architecture === wantedArch)
    || index.manifests?.[0]
    || null;
}

export function selectProbeLayer(manifest, minBytes = 65536) {
  const layers = (manifest.layers || []).filter((layer) => layer.digest && Number.isFinite(layer.size));
  if (!layers.length) return null;
  const preferred = layers.filter((layer) => layer.size >= minBytes).sort((a, b) => a.size - b.size);
  return preferred[0] || [...layers].sort((a, b) => b.size - a.size)[0];
}
