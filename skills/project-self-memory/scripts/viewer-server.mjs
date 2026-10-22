#!/usr/bin/env node
/**
 * HTTP service factory for the compact memory viewer.
 *
 * The factory receives every dependency explicitly (the single-file builder
 * wires the same factory with inlined modules), captures no module-private
 * state and performs all writes through the shared store core + lock +
 * backup pipeline. It serves:
 *
 *   GET  /                    the compact page (no record data embedded)
 *   GET  /api/snapshot        full state snapshot + diagnostics
 *   PATCH /api/records/:id    restricted single-record update
 *
 * Security contract: loopback only, Host allowlist, bearer token for every
 * /api call (reads included), Origin check on writes, conservative whole-store
 * optimistic concurrency (store_revision), non-blocking lock acquisition
 * (503 when busy), strict JSON body limits.
 */
export function createViewerServer(deps) {
  const { fs, path, crypto, http, store, lock, ledger } = deps;
  const { projectRoot, token, pageHtml } = deps;

  const paths = lock.memoryPaths(projectRoot);
  const MAX_BODY = 256 * 1024;
  const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const SCORE_KINDS = new Set([
    'human_positive', 'human_negative', 'applied_success', 'applied_failure',
    'still_valid', 'legacy_positive', 'legacy_negative',
  ]);

  const json = (res, status, payload) => {
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    res.end(bytes);
  };

  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

  /** store_revision: digest over raw bytes of memory.md + evidence.jsonl. */
  function storeRevision() {
    const memory = fs.existsSync(paths.memory) ? fs.readFileSync(paths.memory) : Buffer.alloc(0);
    const evidence = fs.existsSync(paths.ledger) ? fs.readFileSync(paths.ledger) : Buffer.alloc(0);
    return sha(Buffer.concat([memory, Buffer.from([0]), evidence]));
  }

  /** Full snapshot: records with current-version projections + diagnostics. */
  function buildSnapshot() {
    const diagnostics = [];
    let model = null;
    let ledgerEvents = [];
    if (!fs.existsSync(paths.memory)) {
      diagnostics.push({ kind: 'store', message: '缺少 memory.md；查看器只读，不会自动 init', impact: 'fatal' });
    } else {
      try {
        model = store.parseStore(fs.readFileSync(paths.memory, 'utf8'));
        diagnostics.push(...store.writeErrors(model));
      } catch (error) {
        diagnostics.push({ kind: 'store', message: error.message, impact: 'fatal' });
      }
    }
    try {
      ledgerEvents = ledger.readLedger(paths.root, { required: false }).events;
    } catch (error) {
      diagnostics.push({ kind: 'evidence', message: error.message, impact: 'fatal' });
    }
    const nowMs = Date.now();
    const records = [];
    if (model) {
      const invalid = new Set(diagnostics.filter((x) => x.kind === 'record').map((x) => x.id));
      for (const record of model.records) {
        if (invalid.has(record.id)) continue;
        const version = ledger.recordVersion(record);
        const projection = ledger.projectEvents(ledgerEvents, record.id, version);
        const scoreEvents = ledgerEvents.filter((event) => event.record_id === record.id
          && event.record_version === version && SCORE_KINDS.has(event.kind));
        records.push({
          id: record.id,
          type: record.type,
          status: record.status,
          group: record.group,
          content: record.content,
          created_at: record.created_at,
          record_version: version,
          positive: projection.positive,
          negative: projection.negative,
          last_scored_at: projection.last_scored_at,
          event_count: projection.event_count,
          score_event_count: scoreEvents.length,
          freshness: store.ruleFreshness(record, nowMs),
        });
      }
    }
    return {
      format: 'psm-viewer-snapshot-v1',
      store_revision: storeRevision(),
      read_only: diagnostics.some((x) => x.impact === 'fatal'),
      diagnostics,
      groups: model ? model.groups : [],
      group_dimension: model?.store?.group_dimension || '',
      generated_at: new Date(nowMs).toISOString(),
      records,
    };
  }

  function hostOk(req) {
    const host = String(req.headers.host || '');
    const name = host.replace(/:\d+$/, '');
    return ALLOWED_HOSTS.has(name) || ALLOWED_HOSTS.has(host);
  }

  function tokenOk(req) {
    const header = String(req.headers.authorization || '');
    return header === `Bearer ${token}`;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { reject(Object.assign(Error('请求体超限'), { code: 'TOO_LARGE' })); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  /** Restricted single-record update with optimistic whole-store concurrency. */
  async function patchRecord(req, res, id) {
    // Origin: cross-origin browser writes are refused; same-origin fetch sends
    // a matching Origin, non-browser clients may omit it.
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { originHost = ''; }
      if (originHost !== String(req.headers.host || '')) return json(res, 403, { error: 'ORIGIN_REJECTED', message: '拒绝跨源写入' });
    }
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
      return json(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE', message: '只接受 application/json' });
    }
    let body;
    try { body = await readBody(req); } catch (error) {
      return json(res, error.code === 'TOO_LARGE' ? 413 : 400, { error: 'BAD_BODY', message: error.message });
    }
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch {
      return json(res, 400, { error: 'BAD_JSON', message: '请求体不是合法 JSON' });
    }
    const allowed = new Set(['store_revision', 'content', 'type', 'status']);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some((key) => !allowed.has(key))) {
      return json(res, 400, { error: 'BAD_FIELDS', message: '只允许 store_revision、content、type、status 字段' });
    }
    const guardErrors = store.editGuard({ content: payload.content, type: payload.type, status: payload.status });
    if (typeof payload.store_revision !== 'string' || guardErrors.length) {
      return json(res, 400, { error: 'VALIDATION', message: guardErrors.join('；') || '缺少 store_revision' });
    }
    // Non-blocking lock: a busy store answers 503 immediately instead of
    // stalling the event loop behind a synchronous wait.
    const lease = lock.tryAcquireStoreLocks(paths.root);
    if (!lease) return json(res, 503, { error: 'LOCK_BUSY', message: 'memory.lock 或 evidence.lock 正被其他进程持有；稍后重试' });
    try {
      const currentRevision = storeRevision();
      if (currentRevision !== payload.store_revision) {
        return json(res, 409, { error: 'CONFLICT', message: '库已被外部修改；草稿保留在页面，可重新加载后重试', store_revision: currentRevision });
      }
      let model;
      try { model = store.parseStore(fs.readFileSync(paths.memory, 'utf8')); } catch (error) {
        return json(res, 422, { error: 'READ_ONLY', message: `库损坏，只读: ${error.message}` });
      }
      const writeErrors = store.writeErrors(model);
      try { ledger.validateLedger(paths.root); } catch (error) { writeErrors.push({ kind: 'evidence', message: error.message, impact: 'fatal' }); }
      if (writeErrors.length) {
        return json(res, 422, { error: 'READ_ONLY', message: `库损坏，只读: ${writeErrors.map((x) => x.message).join('；')}` });
      }
      const record = model.records.find((x) => x.id === id);
      if (!record) return json(res, 404, { error: 'NOT_FOUND', message: `不存在记录: ${id}` });
      record.content = payload.content.trim();
      record.type = payload.type;
      record.status = payload.status;
      // Sync compatibility projections exactly like the CLI does.
      const events = ledger.readLedger(paths.root).events;
      for (const item of model.records) {
        const projection = ledger.projectEvents(events, item.id, ledger.recordVersion(item));
        item.positive = projection.positive;
        item.negative = projection.negative;
        item.last_scored_at = projection.last_scored_at;
      }
      const bytes = Buffer.from(store.serialize(model), 'utf8');
      const onDisk = fs.readFileSync(paths.memory);
      if (onDisk.equals(bytes)) {
        return json(res, 200, { applied: false, unchanged: true, snapshot: buildSnapshot() });
      }
      // Full-model validation before anything touches disk.
      const reparsed = store.parseStore(bytes.toString('utf8'));
      const revalidate = store.writeErrors(reparsed);
      if (revalidate.length) {
        return json(res, 500, { error: 'SERIALIZE_GUARD', message: `序列化结果校验失败，未写入: ${revalidate.map((x) => x.message).join('；')}` });
      }
      let backup;
      try { backup = lock.backupMemoryFile(paths.root, onDisk); } catch (error) {
        return json(res, 500, { error: 'BACKUP_FAILED', message: `备份失败，未写入: ${error.message}` });
      }
      try { lock.atomicReplace(paths.memory, bytes); } catch (error) {
        return json(res, 500, { error: 'WRITE_FAILED', message: `写入失败: ${error.message}` });
      }
      return json(res, 200, { applied: true, backup: backup.file, snapshot: buildSnapshot() });
    } catch (error) {
      return json(res, 500, { error: 'IO_FAILED', message: error.message });
    } finally {
      lease.release();
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!hostOk(req)) return json(res, 403, { error: 'HOST_REJECTED', message: '仅接受回环 Host' });
    if (url.pathname === '/' && req.method === 'GET') {
      const bytes = Buffer.from(pageHtml, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      });
      res.end(bytes);
      return;
    }
    if (url.pathname === '/api/snapshot' && req.method === 'GET') {
      if (!tokenOk(req)) return json(res, 401, { error: 'UNAUTHORIZED', message: '缺少或错误的访问令牌；请使用本次启动输出的地址' });
      try { return json(res, 200, buildSnapshot()); } catch (error) { return json(res, 500, { error: 'IO_FAILED', message: error.message }); }
    }
    const patchMatch = url.pathname.match(/^\/api\/records\/(\d{4}|[1-9]\d{4,})$/);
    if (patchMatch && req.method === 'PATCH') {
      if (!tokenOk(req)) return json(res, 401, { error: 'UNAUTHORIZED', message: '缺少或错误的访问令牌；请使用本次启动输出的地址' });
      return patchRecord(req, res, patchMatch[1]).catch((error) => json(res, 500, { error: 'IO_FAILED', message: error.message }));
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'NOT_FOUND', message: '未知接口' });
    // No arbitrary file service: everything outside the page and the API 404s.
    return json(res, 404, { error: 'NOT_FOUND', message: '不存在该资源' });
  });

  return { server, paths, storeRevision, buildSnapshot };
}
