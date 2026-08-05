import { buildProxyImage, normalizeImageReference } from './normalize.mjs';

function shellQuote(value, platform = process.platform) {
  if (platform === 'win32') return /[\s"&|<>^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildPullCommand(mirror, image, platform = process.platform) {
  const parsed = normalizeImageReference(image);
  if (!parsed.isDockerHub) throw new Error('The image is not hosted on Docker Hub; it will not be rewritten.');
  return `docker pull ${shellQuote(buildProxyImage(mirror, parsed), platform)}`;
}
