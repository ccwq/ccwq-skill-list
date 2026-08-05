import { buildPullCommand } from './command-builder.mjs';

export function printHuman({ results = [], recommendations, image, scrape, configState, dryRun, verbose = false }) {
  if (configState) console.log(`Cache: ${configState.label}${configState.ageDays == null ? '' : ` (${configState.ageDays.toFixed(1)} days)`}`);
  if (dryRun) console.log('Mode: read-only dry run; cache will not be modified.');
  if (scrape) {
    console.log(`Scrape: ${scrape.candidatesFound} new candidate(s), ${scrape.accepted} accepted.`);
    for (const source of scrape.sources || []) console.log(`  ${source.ok ? 'OK' : 'FAIL'} ${source.url}${source.error ? ` — ${source.error}` : ''}`);
  }
  if (results.length) {
    console.log('\nMirror results:');
    for (const item of [...results].sort((a, b) => (b.score || 0) - (a.score || 0))) {
      const status = item.ok ? 'OK' : 'FAIL';
      const metrics = [`api=${item.api_ms ?? '-'}ms`, `manifest=${item.manifest_ms ?? '-'}ms`];
      if (item.throughput_kib_s != null) metrics.push(`speed=${item.throughput_kib_s}KiB/s`);
      if (item.score != null) metrics.push(`score=${item.score}`);
      console.log(`  ${status} ${item.url}  ${metrics.join('  ')}${item.error ? `  ${item.error}` : ''}`);
    }
  }
  if (!recommendations?.best) {
    console.log('\nNo qualified mirror is available. Run with -f/--scrape after authorization to discover new candidates.');
    return;
  }
  console.log(`\nBest: ${recommendations.best.url}`);
  if (recommendations.backups.length) console.log(`Backups: ${recommendations.backups.map((item) => item.url).join(', ')}`);
  if (image) {
    console.log('\nVerified replacement command (not executed):');
    console.log(buildPullCommand(recommendations.best.url, image));
  }
  if (verbose) {
    console.log(`Lowest latency: ${recommendations.lowestLatency?.url || '-'}`);
    console.log(`Highest throughput: ${recommendations.highestThroughput?.url || '-'}`);
    console.log(`Most stable: ${recommendations.mostStable?.url || '-'}`);
  }
}
