import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { extractCandidates, scrapeSources } from '../scripts/lib/scraper.mjs';

/**
 * Given：混有相关与无关 URL 的镜像来源文本
 * When：按镜像主机模式提取候选
 * Then：只返回规范化的可能镜像地址
 * 防回归：避免把无关链接写入候选缓存
 */
test('extracts and normalizes likely mirror URLs', () => {
  const source = { url: 'https://source.example/list', includeHostPattern: '(docker|mirror|registry)' };
  const found = extractCandidates('Try https://Docker.Example.com/ and https://irrelevant.example/docs.', source);
  assert.deepEqual(found, ['https://docker.example.com']);
});

/**
 * Given：含重复候选且已有一个已知候选的来源页面
 * When：抓取并过滤候选
 * Then：只保留未知且去重后的候选
 * 防回归：避免重复探测和重复写入已有镜像记录
 */
test('scrape bypasses known and duplicate candidates', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('https://docker.one.example/ https://docker.two.example https://docker.two.example/');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const result = await scrapeSources([
      { url: `http://127.0.0.1:${port}/`, source: 'test', includeHostPattern: 'docker' }
    ], { requestTimeoutMs: 2000, maxRedirects: 1, maxScrapeBytes: 65536, maxScrapeCandidates: 10, allowPrivateTestTargets: true }, new Set(['https://docker.one.example']));
    assert.deepEqual(result.candidates.map((x) => x.url), ['https://docker.two.example']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
