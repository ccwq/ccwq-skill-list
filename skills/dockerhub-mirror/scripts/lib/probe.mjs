import { RegistryClient, selectPlatformManifest, selectProbeLayer } from './registry-client.mjs';
import { normalizeMirrorUrl } from './normalize.mjs';

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function errorMessage(error) {
  return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

export async function probeMirror(url, options, { deep = false } = {}) {
  const normalized = normalizeMirrorUrl(url);
  const startedAt = new Date().toISOString();
  const client = new RegistryClient(normalized, options);
  const result = {
    url: normalized,
    ok: false,
    mode: deep ? 'deep' : 'quick',
    tested_at: startedAt,
    api_ms: null,
    manifest_ms: null,
    ttfb_ms: null,
    throughput_kib_s: null,
    error: null
  };
  try {
    const api = await client.probeApi();
    result.api_ms = round(api.elapsedMs);
    if (!api.ok) throw new Error(`Registry API returned HTTP ${api.status}`);

    const repository = options.testImage.repository;
    const reference = options.testImage.reference;
    let manifestResult = await client.getManifest(repository, reference);
    result.manifest_ms = round(manifestResult.elapsedMs);
    let manifest = manifestResult.manifest;
    const mediaType = manifestResult.mediaType || manifest.mediaType || '';
    if (mediaType.includes('manifest.list') || mediaType.includes('image.index') || Array.isArray(manifest.manifests)) {
      const selected = selectPlatformManifest(manifest);
      if (!selected?.digest) throw new Error('Manifest index does not contain a usable platform manifest.');
      manifestResult = await client.getManifest(repository, selected.digest);
      result.manifest_ms = round(result.manifest_ms + manifestResult.elapsedMs);
      manifest = manifestResult.manifest;
    }

    if (deep) {
      const layer = selectProbeLayer(manifest, options.minBlobBytes);
      if (!layer?.digest) throw new Error('Manifest does not contain a usable layer for blob testing.');
      const blob = await client.getBlobMetrics(repository, layer.digest);
      result.ttfb_ms = round(blob.ttfbMs);
      result.throughput_kib_s = round(blob.throughputKibS);
      if (blob.bytesRead < Math.min(options.minBlobBytes, options.maxBlobBytes)) {
        throw new Error(`Blob probe returned only ${blob.bytesRead} bytes.`);
      }
      if (result.throughput_kib_s < options.minThroughputKibS) {
        throw new Error(`Blob throughput ${result.throughput_kib_s} KiB/s is below minimum ${options.minThroughputKibS} KiB/s.`);
      }
    }
    result.ok = true;
    return result;
  } catch (error) {
    result.error = errorMessage(error);
    return result;
  }
}

export async function probeMany(records, options, { deep = false, onResult } = {}) {
  const queue = [...records];
  const output = [];
  const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency, queue.length || 1)) }, async () => {
    while (queue.length) {
      const record = queue.shift();
      const result = await probeMirror(record.url || record, options, { deep });
      result.source = record.source || 'unknown';
      output.push(result);
      await onResult?.(result);
    }
  });
  await Promise.all(workers);
  return output;
}
