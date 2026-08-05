function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function inverseNormalized(value, best, worst) {
  if (!Number.isFinite(value)) return 0;
  if (best === worst) return 1;
  return clamp((worst - value) / (worst - best));
}

function normalized(value, best, worst) {
  if (!Number.isFinite(value)) return 0;
  if (best === worst) return 1;
  return clamp((value - worst) / (best - worst));
}

export function successRate(record) {
  const success = Number(record.success_count || 0);
  const failure = Number(record.failure_count || 0);
  const total = success + failure;
  return total ? success / total : 0.5;
}

export function freshnessScore(record, staleDays = 7, now = Date.now()) {
  const time = Date.parse(record.tested_at || '');
  if (!Number.isFinite(time)) return 0;
  return clamp(1 - (now - time) / (staleDays * 86400000));
}

export function scoreRecords(records, options) {
  const eligible = records.filter((record) => record.ok !== false && Number.isFinite(record.api_ms) && Number.isFinite(record.manifest_ms));
  if (!eligible.length) return records.map((record) => ({ ...record, score: 0 }));
  const apiValues = eligible.map((item) => item.api_ms);
  const manifestValues = eligible.map((item) => item.manifest_ms);
  const throughputValues = eligible.map((item) => item.throughput_kib_s).filter(Number.isFinite);
  const ranges = {
    api: [Math.min(...apiValues), Math.max(...apiValues)],
    manifest: [Math.min(...manifestValues), Math.max(...manifestValues)],
    throughput: throughputValues.length ? [Math.max(...throughputValues), Math.min(...throughputValues)] : [1, 0]
  };
  const w = options.weights;
  return records.map((record) => {
    if (record.ok === false || !Number.isFinite(record.api_ms) || !Number.isFinite(record.manifest_ms)) return { ...record, score: 0 };
    const manifestPart = inverseNormalized(record.manifest_ms, ...ranges.manifest);
    const apiPart = inverseNormalized(record.api_ms, ...ranges.api);
    const throughputPart = throughputValues.length ? normalized(record.throughput_kib_s, ...ranges.throughput) : 0.5;
    const historical = successRate(record);
    const freshness = freshnessScore(record, options.staleDays);
    const penalty = Math.min(0.35, Number(record.consecutive_failures || 0) * 0.1);
    const score = 100 * (
      w.manifestLatency * manifestPart +
      w.throughput * throughputPart +
      w.successRate * historical +
      w.apiLatency * apiPart +
      w.freshness * freshness
    ) * (1 - penalty);
    return { ...record, score: Math.round(score * 100) / 100 };
  });
}

export function recommendations(scored) {
  const usable = scored.filter((item) => item.ok !== false && item.score > 0).sort((a, b) => b.score - a.score);
  if (!usable.length) return { best: null, backups: [], lowestLatency: null, highestThroughput: null, mostStable: null };
  return {
    best: usable[0],
    backups: usable.slice(1, 4),
    lowestLatency: [...usable].sort((a, b) => a.manifest_ms - b.manifest_ms)[0],
    highestThroughput: [...usable].filter((x) => Number.isFinite(x.throughput_kib_s)).sort((a, b) => b.throughput_kib_s - a.throughput_kib_s)[0] || null,
    mostStable: [...usable].sort((a, b) => successRate(b) - successRate(a) || b.score - a.score)[0]
  };
}
