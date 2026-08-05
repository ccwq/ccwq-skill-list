#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveConfigPath,
  readConfig,
  writeConfigAtomic,
  withFileLock,
  backupCorruptConfig,
  emptyConfig,
  findRecord,
  upsertActive,
  moveToQuarantine,
  removeRecord
} from './lib/config-store.mjs';
import { normalizeMirrorUrl } from './lib/normalize.mjs';
import { probeMirror, probeMany } from './lib/probe.mjs';
import { scoreRecords, recommendations } from './lib/scorer.mjs';
import { scrapeSources } from './lib/scraper.mjs';
import { printHuman } from './lib/output.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');

function usage() {
  return `dockerhub-mirror-skill

Usage:
  dockerhub-mirror [options]

Modes:
  (default)                  Quick-test active mirrors and update cache
  -f, --scrape              Scrape built-in sources, deep-test only new URLs, ingest successes
  --deep                    Deep-test active mirrors (API + manifest + small blob)
  --add <url>               Deep-test and add one mirror if qualified
  --remove <url>            Remove one mirror from active or quarantine records
  --list                    List active records without network requests
  --quarantine              List quarantined records without network requests
  --retry-quarantine        Deep-test quarantine; restore success, retire old repeated failures

Safety and output:
  --dry-run                 Never create or modify the cache
  --image <ref>             Print a verified replacement docker pull command; never execute it
  --json                    Emit JSON
  --verbose                 Show scenario recommendations and source details

Overrides:
  --config <path>           Cache path (default: ~/.config/dockerhub-mirror-skill.ini)
  --timeout <ms>            Per-request timeout
  --concurrency <n>         Concurrent probes
  --max-age <days>          Override stale threshold used for cache classification
  -h, --help                Show this help

The tool never modifies Docker daemon settings and never executes docker pull or docker run.`;
}

function parseArgs(argv) {
  const args = { scrape: false, deep: false, dryRun: false, json: false, verbose: false, list: false, quarantine: false, retryQuarantine: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') args.help = true;
    else if (arg === '-f' || arg === '--scrape') args.scrape = true;
    else if (arg === '--deep') args.deep = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--verbose') args.verbose = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--quarantine') args.quarantine = true;
    else if (arg === '--retry-quarantine') args.retryQuarantine = true;
    else if (['--add', '--remove', '--image', '--config', '--timeout', '--concurrency', '--max-age'].includes(arg)) {
      if (i + 1 >= argv.length) throw new Error(`${arg} requires a value.`);
      const key = { '--add': 'add', '--remove': 'remove', '--image': 'image', '--config': 'config', '--timeout': 'timeout', '--concurrency': 'concurrency', '--max-age': 'maxAge' }[arg];
      args[key] = argv[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  const primary = [args.scrape, Boolean(args.add), Boolean(args.remove), args.list, args.quarantine, args.retryQuarantine].filter(Boolean).length;
  if (primary > 1) throw new Error('Choose only one primary mode: --scrape, --add, --remove, --list, --quarantine, or --retry-quarantine.');
  return args;
}

async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(ROOT_DIR, relative), 'utf8'));
}

function numericOverride(value, label, { integer = false, min = 0 } = {}) {
  if (value == null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || (integer && !Number.isInteger(number))) throw new Error(`${label} must be ${integer ? 'an integer' : 'a number'} >= ${min}.`);
  return number;
}

function cacheState(config, options) {
  if (!config.updatedAt) return { label: 'missing', ageDays: null, shouldSuggestScrape: true };
  const timestamp = Date.parse(config.updatedAt);
  if (!Number.isFinite(timestamp)) return { label: 'invalid-date', ageDays: null, shouldSuggestScrape: true };
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86400000);
  if (ageDays <= options.freshDays) return { label: 'fresh', ageDays, shouldSuggestScrape: false };
  if (ageDays <= options.staleDays) return { label: 'stale', ageDays, shouldSuggestScrape: true };
  return { label: 'expired', ageDays, shouldSuggestScrape: true };
}

function historyMerged(result, existing) {
  return {
    ...existing,
    ...result,
    source: result.source || existing?.source || 'unknown',
    success_count: Number(existing?.success_count || 0),
    failure_count: Number(existing?.failure_count || 0),
    consecutive_failures: Number(existing?.consecutive_failures || 0)
  };
}

function applyResult(config, rawResult, options, { persistNewFailure = false } = {}) {
  const existing = findRecord(config, rawResult.url);
  const record = historyMerged(rawResult, existing);
  delete record.ok;
  delete record.mode;
  delete record.error;
  if (rawResult.ok) {
    record.status = 'active';
    record.success_count += 1;
    record.consecutive_failures = 0;
    record.last_success_at = rawResult.tested_at;
    record.last_error = '';
    return upsertActive(config, record);
  }
  if (!existing && !persistNewFailure) return null;
  record.failure_count += 1;
  record.consecutive_failures += 1;
  record.last_failure_at = rawResult.tested_at;
  record.last_error = rawResult.error || 'unknown failure';
  if (record.consecutive_failures >= options.quarantineAfterFailures) return moveToQuarantine(config, record);
  record.status = 'degraded';
  return upsertActive(config, record);
}

async function loadConfigSafely(configPath, writeMode) {
  try {
    return await readConfig(configPath);
  } catch (error) {
    if (!writeMode) throw error;
    const backup = await backupCorruptConfig(configPath);
    process.stderr.write(`Warning: corrupt config backed up to ${backup}; starting with an empty cache.\n`);
    return emptyConfig();
  }
}

async function save(configPath, config) {
  await withFileLock(configPath, () => writeConfigAtomic(configPath, config));
}

function listPayload(config, kind) {
  const records = kind === 'quarantine' ? config.quarantine : config.mirrors;
  return records.map((item) => ({ ...item }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const defaults = await readJson('config/defaults.json');
  const seeds = await readJson('config/mirror-seeds.json');
  const sources = await readJson('config/scrape-sources.json');
  const options = {
    ...defaults,
    requestTimeoutMs: numericOverride(args.timeout, '--timeout', { integer: true, min: 100 }) ?? defaults.requestTimeoutMs,
    concurrency: numericOverride(args.concurrency, '--concurrency', { integer: true, min: 1 }) ?? defaults.concurrency,
    staleDays: numericOverride(args.maxAge, '--max-age', { min: 0.01 }) ?? defaults.staleDays
  };
  const configPath = resolveConfigPath(args.config);
  const writeMode = !args.dryRun && !args.list && !args.quarantine;
  let config = await loadConfigSafely(configPath, writeMode);
  const state = cacheState(config, options);

  if (args.list || args.quarantine) {
    const records = listPayload(config, args.quarantine ? 'quarantine' : 'active');
    if (args.json) console.log(JSON.stringify({ configPath, state, records }, null, 2));
    else if (!records.length) console.log(`No ${args.quarantine ? 'quarantined' : 'active'} mirrors recorded.`);
    else for (const item of records) console.log(`${item.url}\t${item.status}\t${item.manifest_ms ?? '-'}ms\t${item.throughput_kib_s ?? '-'}KiB/s`);
    return;
  }

  if (args.remove) {
    const normalized = normalizeMirrorUrl(args.remove);
    const removed = removeRecord(config, normalized);
    if (!args.dryRun && removed) await save(configPath, config);
    const payload = { action: 'remove', url: normalized, removed, dryRun: args.dryRun, configPath };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else console.log(removed ? `${args.dryRun ? 'Would remove' : 'Removed'} ${normalized}` : `Not recorded: ${normalized}`);
    return;
  }

  if (args.add) {
    const url = normalizeMirrorUrl(args.add);
    const result = await probeMirror(url, options, { deep: true });
    result.source = 'manual';
    let accepted = false;
    if (result.ok) {
      accepted = true;
      applyResult(config, result, options);
      if (!args.dryRun) await save(configPath, config);
    }
    const scored = scoreRecords([historyMerged(result, findRecord(config, url))], options);
    const payload = { action: 'add', accepted, dryRun: args.dryRun, result: scored[0], configPath };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else printHuman({ results: scored, recommendations: recommendations(scored), image: args.image, configState: state, dryRun: args.dryRun, verbose: args.verbose });
    process.exitCode = accepted ? 0 : 2;
    return;
  }

  if (args.scrape) {
    const known = new Set([...config.mirrors, ...config.quarantine].map((item) => item.url));
    const scraped = await scrapeSources(sources, options, known);
    const results = await probeMany(scraped.candidates, options, { deep: true });
    const acceptedResults = results.filter((item) => item.ok);
    for (const result of acceptedResults) applyResult(config, result, options);
    let scored = scoreRecords(results.map((item) => historyMerged(item, findRecord(config, item.url))), options);
    for (const item of scored) {
      const existing = findRecord(config, item.url);
      if (existing && item.ok) existing.score = item.score;
    }
    if (!args.dryRun && acceptedResults.length) await save(configPath, config);
    const recs = recommendations(scored);
    const scrapeSummary = { candidatesFound: scraped.candidates.length, accepted: acceptedResults.length, sources: scraped.sources };
    const payload = { action: 'scrape', dryRun: args.dryRun, configPath, scrape: scrapeSummary, results: scored, recommendations: recs };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else printHuman({ results: scored, recommendations: recs, image: args.image, scrape: scrapeSummary, configState: state, dryRun: args.dryRun, verbose: args.verbose });
    process.exitCode = recs.best ? 0 : 2;
    return;
  }

  if (args.retryQuarantine) {
    const targets = [...config.quarantine];
    const results = await probeMany(targets, options, { deep: true });
    const retentionMs = options.quarantineRetentionDays * 86400000;
    for (const result of results) {
      const previous = findRecord(config, result.url);
      if (result.ok) applyResult(config, result, options);
      else {
        const lastFailure = Date.parse(previous?.last_failure_at || previous?.tested_at || '');
        if (Number.isFinite(lastFailure) && Date.now() - lastFailure >= retentionMs) removeRecord(config, result.url);
        else applyResult(config, result, options, { persistNewFailure: true });
      }
    }
    const scored = scoreRecords(results.map((item) => historyMerged(item, findRecord(config, item.url))), options);
    if (!args.dryRun && results.length) await save(configPath, config);
    const recs = recommendations(scored);
    if (args.json) console.log(JSON.stringify({ action: 'retry-quarantine', dryRun: args.dryRun, configPath, results: scored, recommendations: recs }, null, 2));
    else printHuman({ results: scored, recommendations: recs, image: args.image, configState: state, dryRun: args.dryRun, verbose: args.verbose });
    return;
  }

  const targets = config.mirrors.length ? [...config.mirrors] : seeds;
  let writeChain = Promise.resolve();
  const results = await probeMany(targets, options, {
    deep: args.deep,
    onResult: args.dryRun ? undefined : async (result) => {
      writeChain = writeChain.then(async () => {
        applyResult(config, result, options);
        await save(configPath, config);
      });
      await writeChain;
    }
  });
  await writeChain;
  const merged = results.map((item) => historyMerged(item, findRecord(config, item.url)));
  const scored = scoreRecords(merged, options);
  for (const item of scored) {
    const existing = findRecord(config, item.url);
    if (existing) existing.score = item.score;
  }
  if (!args.dryRun && results.length) await save(configPath, config);
  const recs = recommendations(scored);
  const payload = { action: args.deep ? 'deep-check' : 'quick-check', dryRun: args.dryRun, configPath, state, results: scored, recommendations: recs, scrapeSuggested: !recs.best || state.shouldSuggestScrape };
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else printHuman({ results: scored, recommendations: recs, image: args.image, configState: state, dryRun: args.dryRun, verbose: args.verbose });
  process.exitCode = recs.best ? 0 : 2;
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message || error}\n`);
  process.exitCode = 1;
});
