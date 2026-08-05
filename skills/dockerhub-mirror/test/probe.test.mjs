import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeMirror } from '../scripts/lib/probe.mjs';

function createRegistry() {
  const blob = Buffer.alloc(128 * 1024, 7);
  return http.createServer((req, res) => {
    const url = decodeURIComponent(req.url);
    if (url === '/v2/' || url === '/v2') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    if (url === '/v2/library/busybox/manifests/1.36.1') {
      res.writeHead(200, { 'content-type': 'application/vnd.docker.distribution.manifest.v2+json' });
      res.end(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.docker.distribution.manifest.v2+json', layers: [{ mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip', size: blob.length, digest: 'sha256:abc' }] }));
      return;
    }
    if (url === '/v2/library/busybox/blobs/sha256:abc') {
      res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-length': blob.length, 'content-range': `bytes 0-${blob.length - 1}/${blob.length}` });
      res.end(blob);
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

/**
 * Given：本地模拟 Registry 与有限大小的 Blob
 * When：分别执行快速和深度探测
 * Then：两种探测均成功，深度探测返回吞吐量与首字节延迟
 * 防回归：避免深度探测无界下载或遗漏关键性能指标
 */
test('performs quick and deep registry probes against a bounded blob sample', async () => {
  const server = createRegistry();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const options = {
    requestTimeoutMs: 2000,
    maxRedirects: 1,
    maxManifestBytes: 1024 * 1024,
    maxBlobBytes: 64 * 1024,
    minBlobBytes: 1024,
    minThroughputKibS: 1,
    allowPrivateTestTargets: true,
    testImage: { repository: 'library/busybox', reference: '1.36.1' }
  };
  try {
    const quick = await probeMirror(`http://127.0.0.1:${port}`, options, { deep: false });
    assert.equal(quick.ok, true, quick.error);
    assert.equal(quick.throughput_kib_s, null);
    const deep = await probeMirror(`http://127.0.0.1:${port}`, options, { deep: true });
    assert.equal(deep.ok, true, deep.error);
    assert.ok(deep.throughput_kib_s > 0);
    assert.ok(deep.ttfb_ms >= 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
