import { fetchWithPolicy, decodeUtf8 } from './net.mjs';
import { normalizeMirrorUrl } from './normalize.mjs';

const URL_RE = /https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]*)?/g;

function cleanCandidate(value) {
  return value.replace(/[),.;\]}]+$/, '');
}

export function extractCandidates(text, source) {
  const candidates = new Set();
  const hostPattern = source.includeHostPattern ? new RegExp(source.includeHostPattern, 'i') : null;
  for (const match of String(text).matchAll(URL_RE)) {
    try {
      const normalized = normalizeMirrorUrl(cleanCandidate(match[0]));
      const url = new URL(normalized);
      if (hostPattern && !hostPattern.test(`${url.hostname}${url.pathname}`)) continue;
      if (url.hostname === new URL(source.url).hostname && !/(docker|mirror|registry|proxy|hub)/i.test(url.pathname)) continue;
      candidates.add(normalized);
    } catch {}
  }
  return [...candidates];
}

export async function scrapeSources(sources, options, knownUrls = new Set()) {
  const discovered = new Map();
  const sourceResults = [];
  for (const source of sources) {
    try {
      const result = await fetchWithPolicy(source.url, {
        timeoutMs: options.requestTimeoutMs,
        maxRedirects: options.maxRedirects,
        maxBytes: options.maxScrapeBytes,
        headers: { 'User-Agent': 'dockerhub-mirror-skill/0.1', Accept: 'text/html,application/json,text/plain' },
        validateUrl: !options.allowPrivateTestTargets
      });
      if (!result.response.ok) throw new Error(`HTTP ${result.response.status}`);
      const candidates = extractCandidates(decodeUtf8(result.bytes), source);
      let added = 0;
      for (const url of candidates) {
        if (knownUrls.has(url) || discovered.has(url)) continue;
        discovered.set(url, { url, source: source.source || source.url });
        added += 1;
        if (discovered.size >= options.maxScrapeCandidates) break;
      }
      sourceResults.push({ url: source.url, ok: true, candidates: candidates.length, added });
    } catch (error) {
      sourceResults.push({ url: source.url, ok: false, error: String(error.message || error) });
    }
    if (discovered.size >= options.maxScrapeCandidates) break;
  }
  return { candidates: [...discovered.values()], sources: sourceResults };
}
