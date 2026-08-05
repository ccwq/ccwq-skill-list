import path from 'node:path';

const DOCKER_HUB_HOSTS = new Set(['docker.io', 'index.docker.io', 'registry-1.docker.io']);

export function normalizeMirrorUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Mirror URL must be a non-empty string.');
  }
  let value = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported protocol: ${url.protocol}`);
  if (url.username || url.password) throw new Error('Mirror URL must not contain credentials.');
  if (url.search || url.hash) throw new Error('Mirror URL must not contain query parameters or fragments.');
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  if (!url.pathname) url.pathname = '';
  return url.toString().replace(/\/$/, '');
}

export function mirrorId(input) {
  const url = new URL(normalizeMirrorUrl(input));
  const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  return `${host}${url.pathname}`;
}

export function normalizeImageReference(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Image reference must be a non-empty string.');
  const raw = input.trim().replace(/^docker:\/\//, '');
  const slash = raw.indexOf('/');
  const first = slash === -1 ? raw : raw.slice(0, slash);
  const explicitRegistry = slash !== -1 && (first.includes('.') || first.includes(':') || first === 'localhost');
  let registry = explicitRegistry ? first.toLowerCase() : 'docker.io';
  let remainder = explicitRegistry ? raw.slice(slash + 1) : raw;
  if (DOCKER_HUB_HOSTS.has(registry)) registry = 'docker.io';
  if (registry !== 'docker.io') {
    return { isDockerHub: false, registry, original: input, canonical: raw };
  }
  if (!remainder.includes('/')) remainder = `library/${remainder}`;
  let repository = remainder;
  let reference = 'latest';
  const digestIndex = remainder.indexOf('@');
  if (digestIndex >= 0) {
    repository = remainder.slice(0, digestIndex);
    reference = remainder.slice(digestIndex + 1);
  } else {
    const lastSlash = remainder.lastIndexOf('/');
    const lastColon = remainder.lastIndexOf(':');
    if (lastColon > lastSlash) {
      repository = remainder.slice(0, lastColon);
      reference = remainder.slice(lastColon + 1);
    }
  }
  if (!repository || !reference) throw new Error(`Invalid image reference: ${input}`);
  const separator = reference.startsWith('sha256:') ? '@' : ':';
  return {
    isDockerHub: true,
    registry: 'docker.io',
    repository,
    reference,
    canonical: `docker.io/${repository}${separator}${reference}`,
    original: input
  };
}

export function buildProxyImage(mirror, image) {
  const normalizedMirror = normalizeMirrorUrl(mirror);
  const parsed = typeof image === 'string' ? normalizeImageReference(image) : image;
  if (!parsed.isDockerHub) throw new Error('Only Docker Hub image references can be rewritten.');
  const separator = parsed.reference.startsWith('sha256:') ? '@' : ':';
  return `${normalizedMirror}/${parsed.repository}${separator}${parsed.reference}`;
}

export function defaultConfigPath(homeDir, platform = process.platform) {
  // path.join produces native separators on Windows and POSIX-like systems.
  return path.join(homeDir, '.config', 'dockerhub-mirror-skill.ini');
}
