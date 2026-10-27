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
 *   GET  /api/snapshot        full state snapshot + diagnostics + cache section
 *   PATCH /api/records/:id    restricted single-record update
 *   POST /api/cache/:id/apply     land one pending cache candidate into the store
 *   POST /api/cache/:id/discard   mark one pending candidate discarded (cache-only)
 *   POST /api/cache/prune         drop processed/stale candidates (cache-only)
 *
 * Security contract: loopback only, Host allowlist, bearer token for every
 * /api call (reads included), Origin check on writes, conservative whole-store
 * optimistic concurrency (store_revision), non-blocking lock acquisition
 * (503 when busy), strict JSON body limits.
 */
export function createViewerServer(deps) {
  const { fs, path, crypto, http, store, lock, ledger, tags, cache } = deps;
  const { projectRoot, token, pageHtml } = deps;

  const paths = lock.memoryPaths(projectRoot);
  const cacheFile = cache ? cache.cachePaths(projectRoot) : null;
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
    // 标签只是只读旁路元数据：每次快照重载，不能影响存储版本或保存权限。
    const tagState = tags.loadTagTaxonomy(projectRoot);
    diagnostics.push(...tagState.diagnostics);
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
          tags: tagState.enabled ? tags.deriveTags(record, tagState.taxonomy) : [],
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
      format: 'psm-viewer-snapshot-v2',
      // overrides 已反映到记录标签中，不随快照重复传输所有逐记录修正。
      taxonomy: { version: tagState.taxonomy.version, tags: tagState.taxonomy.tags },
      store_revision: storeRevision(),
      read_only: diagnostics.some((x) => x.impact === 'fatal'),
      diagnostics,
      groups: model ? model.groups : [],
      group_dimension: model?.store?.group_dimension || '',
      generated_at: new Date(nowMs).toISOString(),
      records,
      // cache 节是只读旁路：store_revision 口径不变（仍只哈希 memory.md 与
      // evidence.jsonl），cache 不参与其计算。
      cache: buildCacheSection(model, diagnostics),
    };
  }

  /**
   * 快照 cache 节（冻结 schema，工单 02-A）：pending 条目经读时失效派生后按
   * 既有 groupEntries 规则分组，每组附目标记录现状 current。cache 文件缺失
   * 视为空；store 不可读时 versions 传 null，stale 全部为 null（未知不猜）。
   * cache 模块缺失或 cache.jsonl 损坏时降级为空节并记诊断，不阻断整个快照。
   */
  function buildCacheSection(model, diagnostics) {
    if (!cache) return { count: 0, groups: [] };
    let scoped = [];
    try {
      scoped = cache.readCache(projectRoot).filter((entry) => entry.status === 'pending');
    } catch (error) {
      diagnostics.push({ kind: 'cache', message: error.message, impact: 'warning' });
      return { count: 0, groups: [] };
    }
    // 版本对照用快照已解析的记忆库模型；store 不可读（model=null）时传 null，
    // deriveStale 全部 stale:null，不猜。
    const versions = model ? new Map(model.records.map((record) => [record.id, ledger.recordVersion(record)])) : null;
    const derived = cache.deriveStale(scoped, versions);
    const groups = cache.groupEntries(derived).map((group) => ({
      ...group,
      // 对齐 CLI cacheList（memory.mjs cacheTargetSnapshot）：目标记录不存在
      // 时 exists:false，各字段为 null。
      // 冻结 schema：add 组（refid=null）current 为 null；有 refid 但模型里
      // 查不到（或模型不可用）→ exists:false、各字段 null。
      current: group.refid === null
        ? null
        : (model ? cacheTargetCurrent(model, group.refid) : { exists: false, record_version: null, content: null, type: null }),
    }));
    return { count: scoped.length, groups };
  }

  function cacheTargetCurrent(model, refid) {
    const record = model.records.find((item) => item.id === refid);
    if (!record) return { exists: false, record_version: null, content: null, type: null };
    return {
      exists: true,
      record_version: ledger.recordVersion(record),
      content: String(record.content || ''),
      type: record.type,
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
    const payload = await readJsonPostBody(req, res, ['store_revision', 'content', 'type', 'status']);
    if (!payload) return;
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
      // Single-line contract applies only to content that actually changes;
      // resubmitting the record's own body stays a valid metadata-only edit.
      const nextContent = String(payload.content).trim();
      if (nextContent !== String(record.content || '').trim()) {
        const contractErrors = store.contentContractErrors(payload.content);
        if (contractErrors.length) {
          return json(res, 400, { error: 'CONTRACT', message: contractErrors.join('；') });
        }
      }
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

  /**
   * 写路由共用的安检链（patchRecord 与三条 cache 路由同构）：写方法先过 Origin
   * 同源（403 ORIGIN_REJECTED），再 Content-Type（415）、限长读体（413/400
   * BAD_BODY）、JSON 合法（400 BAD_JSON）、字段白名单（400 BAD_FIELDS，白名单
   * 按传入顺序拼接进错误文案）。返回解析后的 payload；已应答时返回 null。
   */
  async function readJsonPostBody(req, res, allowedFields) {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { originHost = ''; }
      if (originHost !== String(req.headers.host || '')) {
        json(res, 403, { error: 'ORIGIN_REJECTED', message: '拒绝跨源写入' });
        return null;
      }
    }
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
      json(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE', message: '只接受 application/json' });
      return null;
    }
    let body;
    try { body = await readBody(req); } catch (error) {
      json(res, error.code === 'TOO_LARGE' ? 413 : 400, { error: 'BAD_BODY', message: error.message });
      return null;
    }
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch {
      json(res, 400, { error: 'BAD_JSON', message: '请求体不是合法 JSON' });
      return null;
    }
    const allowed = new Set(allowedFields);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some((key) => !allowed.has(key))) {
      json(res, 400, { error: 'BAD_FIELDS', message: `只允许 ${[...allowed].join('、')} 字段` });
      return null;
    }
    return payload;
  }

  /**
   * 落库写入复刻 CLI cacheWriteThrough（memory.mjs L727-776）的语义，只复用
   * store/ledger 原语，不 import CLI 函数。持锁调用：
   * - add：store 游标取新 id + push（status active、评分归零）；
   * - update：定位记录改正文 + 评分投影重置；
   * - delete：records 过滤；
   * - ±1：kind 归一化 + task_id 取合法 source 否则 'cache' + assertBaselineFresh
   *   + appendEvent（幂等键 cache-apply-<event_id>，与 CLI 同键；duplicate 按
   *   幂等成功处理）。
   * save 内部完成全量校验、投影同步、备份与原子替换；失败即抛，条目保持 pending。
   */
  function cacheWriteThrough(entry, model) {
    const now = store.timestamp();
    if (entry.type === 'add') {
      const id = newIdFor(model);
      model.records.push({
        id, type: entry.payload.record_type, status: 'active', positive: 0, negative: 0,
        created_at: now, last_scored_at: '', content: entry.payload.content, group: entry.payload.group,
      });
      saveModel(model);
      return { record_id: id };
    }
    if (entry.type === 'update') {
      const record = model.records.find((item) => item.id === entry.target_refid);
      // 与 CLI update 一致：正文变更后 record_version 变化，旧投影不再适用。
      record.content = entry.payload.content;
      record.positive = 0; record.negative = 0; record.last_scored_at = '';
      saveModel(model);
      return { record_id: record.id };
    }
    if (entry.type === 'delete') {
      const record = model.records.find((item) => item.id === entry.target_refid);
      model.records = model.records.filter((item) => item.id !== record.id);
      saveModel(model);
      return { record_id: record.id, deleted: true };
    }
    const record = model.records.find((item) => item.id === entry.target_refid);
    const version = ledger.recordVersion(record);
    const positive = entry.type === '+1';
    const kind = entry.evidence.kind && (positive
      ? ['applied_success', 'still_valid', 'human_positive'].includes(entry.evidence.kind)
      : ['applied_failure', 'human_negative'].includes(entry.evidence.kind))
      ? entry.evidence.kind
      : (positive ? 'human_positive' : 'human_negative');
    const taskId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(entry.source) ? entry.source : 'cache';
    // 账本事件在记忆库写入之前落盘，先做乐观并发预检，基线被外部改动直接拒绝。
    assertBaselineFresh(model);
    // 调用方已持 evidence.lock，不能走会自取阻塞锁的 ledger.appendEvent；
    // 用其导出原语按 appendEvent 的幂等语义内联复刻（duplicate 视为幂等成功）。
    const current = ledger.readLedger(paths.root);
    const event = {
      schema_version: ledger.LEDGER_VERSION,
      event_id: `cache-apply-${entry.event_id}`,
      record_id: record.id,
      record_version: version,
      task_id: taskId,
      kind,
      observed_at: entry.evidence.observed_at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      source: cache.AUTOMATIC_EVIDENCE_KINDS.has(kind) ? 'automatic' : 'manual',
    };
    const existing = current.byId.get(event.event_id);
    if (existing) {
      // 与 appendEvent 相同：observed_at 不参与幂等比较。
      const comparable = (item) => { const { observed_at, ...rest } = item; return rest; };
      if (JSON.stringify(comparable(existing)) !== JSON.stringify(comparable(event))) {
        throw Error(`event_id 冲突: ${event.event_id}`);
      }
      return { record_id: record.id, evidence_kind: kind, duplicate_event: true };
    }
    fs.appendFileSync(paths.ledger, `${JSON.stringify(event)}\n`, 'utf8');
    saveModel(model);
    return { record_id: record.id, evidence_kind: kind, duplicate_event: false };
  }

  /** CLI newId 的等效实现（store 游标取新 id 并推进）。 */
  function newIdFor(model) {
    const id = model.store.next_id;
    model.store.next_id = (BigInt(id) + 1n).toString().padStart(id.length, '0');
    return id;
  }

  /**
   * CLI save 的无锁复刻：调用方已持有 memory.lock + evidence.lock。
   * mustWritable 式全量校验 → syncProjections → 基线比对（与 CLI save 同口径）
   * → serialize → 复查 → 备份 → 原子替换。任何失败先于持久化抛出。
   */
  function saveModel(model) {
    const writeErrors = store.writeErrors(model);
    try { ledger.validateLedger(paths.root); } catch (error) { writeErrors.push({ kind: 'evidence', message: error.message, impact: 'fatal' }); }
    if (writeErrors.length) throw Error(`拒绝写入损坏库: ${writeErrors.map((x) => x.message).join('；')}`);
    const ledgerEvents = ledger.readLedger(paths.root).events;
    for (const item of model.records) {
      const projection = ledger.projectEvents(ledgerEvents, item.id, ledger.recordVersion(item));
      item.positive = projection.positive;
      item.negative = projection.negative;
      item.last_scored_at = projection.last_scored_at;
    }
    const file = paths.memory;
    const onDisk = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
    const fresh = onDisk.length ? store.parseStore(onDisk.toString('utf8')) : null;
    if (!fresh || !fresh.store) throw Error('拒绝写入损坏库: 加锁后重读失败');
    // 与 CLI save 相同的基线比对：next_id、分组形状、分组归属、重叠记录
    // 身份（type|status|content）与被移除记录。
    const before = new Map((fresh.records || []).map((r) => [r.id, `${r.type}|${r.status}|${r.content}`]));
    const edited = new Map(model.records.map((r) => [r.id, `${r.type}|${r.status}|${r.content}`]));
    const overlap = [...edited.keys()].filter((id) => before.has(id));
    const changedOverlap = overlap.filter((id) => before.get(id) !== edited.get(id));
    const removed = [...before.keys()].filter((id) => !edited.has(id));
    // 基线比对与 CLI save 同口径：`__baseline === null` 表示「持锁后刚读过、
    // 本进程就是当前写者」，等效 baselineKnown=true，跳过冲突比对；仅当基线
    // 摘要与磁盘不一致时才逐项比对并拒绝（±1 路径的二次预检）。
    const baselineKnown = model.__baseline === null || model.__baseline === sha(onDisk);
    if (!baselineKnown) {
      const diverged = [];
      if (String(fresh.store.next_id) !== String(model.store.next_id)) diverged.push('next_id');
      const groupShape = (m) => JSON.stringify(m.groups || []) + '|' + (m.store.group_dimension || '');
      if (groupShape(fresh) !== groupShape(model)) diverged.push('groups');
      const freshAssign = new Map((fresh.records || []).map((r) => [r.id, r.group || null]));
      const assignChanged = model.records.filter((r) => freshAssign.has(r.id) && freshAssign.get(r.id) !== (r.group || null)).map((r) => r.id);
      if (assignChanged.length) diverged.push(`分组归属 ${assignChanged.join(', ')}`);
      if (diverged.length || changedOverlap.length || removed.length) {
        throw Object.assign(Error(`PSM_CONFLICT: memory.md 已被外部修改（${changedOverlap.concat(removed, diverged).join(', ') || '?'}）；重读后重试`), { code: 'STORE_CONFLICT' });
      }
    }
    const bytes = Buffer.from(store.serialize(model), 'utf8');
    if (onDisk.equals(bytes)) return false;
    let backup;
    try { backup = lock.backupMemoryFile(paths.root, onDisk); } catch (error) {
      throw Object.assign(Error(`备份失败，未写入: ${error.message}`), { code: 'BACKUP_FAILED' });
    }
    try { lock.atomicReplace(file, bytes); } catch (error) {
      throw Object.assign(Error(`写入失败: ${error.message}`), { code: 'WRITE_FAILED' });
    }
    return { backup: backup.file };
  }

  /**
   * CLI assertBaselineFresh 的等效（仅 ±1 路径）：先写账本后写库，写前确认
   * 基线仍与磁盘一致，避免校验失败时留下半条账本事件。基线取「持锁后读入
   * 模型的当前磁盘摘要」，即本次成功校验时刻的快照。
   */
  function assertBaselineFresh(model) {
    if (!fs.existsSync(paths.memory)) throw Error('PSM_CONFLICT: memory.md 已不存在；重读后重试');
    // 持锁窗口内磁盘只可能因本进程变化；基线未知（null）时以当前磁盘为准。
    if (model.__baseline !== null && model.__baseline !== sha(fs.readFileSync(paths.memory))) {
      throw Error('PSM_CONFLICT: memory.md 已被外部修改；重读后重试');
    }
    model.__baseline = sha(fs.readFileSync(paths.memory));
  }

  /**
   * POST /api/cache/<event_id>/apply：把一条 pending 候选落库。
   * 锁序 cache.lock → memory.lock + evidence.lock（tryAcquireStoreLocks），
   * 全部非阻塞，忙即 503。持锁后重读磁盘（防 TOCTOU），持久化次序与 CLI
   * cacheApply 一致：库写入全部成功后才标 applied + processed_at 并写 cache。
   */
  async function applyCacheEntry(req, res, eventId) {
    const payload = await readJsonPostBody(req, res, ['store_revision', 'content']);
    if (!payload) return;
    if (typeof payload.store_revision !== 'string' || !payload.store_revision) {
      return json(res, 400, { error: 'VALIDATION', message: '缺少 store_revision' });
    }
    if (payload.content !== undefined && typeof payload.content !== 'string') {
      return json(res, 400, { error: 'VALIDATION', message: 'content 必须是字符串' });
    }
    const cacheLease = lock.tryAcquireLock(cacheFile.lock);
    if (!cacheLease) return json(res, 503, { error: 'LOCK_BUSY', message: 'cache.lock 正被其他进程持有；稍后重试' });
    try {
      const entries = cache.readCache(projectRoot);
      const index = entries.findIndex((entry) => entry.event_id === eventId);
      if (index < 0) return json(res, 404, { error: 'NOT_FOUND', message: `不存在 cache 条目: ${eventId}` });
      // 持锁后重读确认条目仍 pending，防 TOCTOU。
      if (entries[index].status !== 'pending') {
        return json(res, 409, { error: 'CONFLICT', message: `cache 条目不是 pending（${entries[index].status}），拒绝落库` });
      }
      // op 非 add/update 时请求带 content → 400 VALIDATION（工单冻结决定）。
      if (payload.content !== undefined && !['add', 'update'].includes(entries[index].type)) {
        return json(res, 400, { error: 'VALIDATION', message: '该操作类型不接受 content 改写' });
      }
      // 提交正文 = 请求改写版（存在时）否则条目暂存版；落库这一刻过单行契约。
      // ±1/delete 条目无 payload（null），正文校验仅对 add/update 有意义。
      const entry = entries[index];
      const content = payload.content !== undefined
        ? payload.content.trim()
        : (entry.payload ? entry.payload.content : null);
      if (entry.payload || payload.content !== undefined) {
        const contractErrors = store.contentContractErrors(content);
        if (contractErrors.length) return json(res, 400, { error: 'CONTRACT', message: contractErrors.join('；') });
      }
      const storeLease = lock.tryAcquireStoreLocks(paths.root);
      if (!storeLease) return json(res, 503, { error: 'LOCK_BUSY', message: 'memory.lock 或 evidence.lock 正被其他进程持有；稍后重试' });
      try {
        // 只读守卫在持锁后：库损坏一律 422，条目保持 pending。
        let model;
        try { model = store.parseStore(fs.readFileSync(paths.memory, 'utf8')); } catch (error) {
          return json(res, 422, { error: 'READ_ONLY', message: `库损坏，只读: ${error.message}` });
        }
        const writeErrors = store.writeErrors(model);
        try { ledger.validateLedger(paths.root); } catch (error) { writeErrors.push({ kind: 'evidence', message: error.message, impact: 'fatal' }); }
        if (writeErrors.length) {
          return json(res, 422, { error: 'READ_ONLY', message: `库损坏，只读: ${writeErrors.map((x) => x.message).join('；')}` });
        }
        // 失效守卫：目标记录不存在或版本已变（原基准 vs 现状）→ 409 拒直写。
        if (entry.target_refid) {
          const record = model.records.find((item) => item.id === entry.target_refid);
          if (!record) {
            return json(res, 409, { error: 'CONFLICT', message: `目标记录已不存在（${entry.target_refid}）；原基准已被删除，请基于现状重新评估` });
          }
          const version = ledger.recordVersion(record);
          if (version !== entry.target_record_version) {
            return json(res, 409, {
              error: 'CONFLICT',
              message: `目标记录已变更（${entry.target_refid}）；候选基于原基准「${String(entry.base_content || '')}」，现状为「${String(record.content || '')}」，请基于现状重新评估`,
            });
          }
        }
        // 乐观并发：请求携带的 store_revision 必须等于当前值。
        const currentRevision = storeRevision();
        if (currentRevision !== payload.store_revision) {
          return json(res, 409, { error: 'CONFLICT', message: '库已被外部修改；请刷新后重试', store_revision: currentRevision });
        }
        // 落库模型：请求带改写版时换成提交正文；基线戳在模型上供
        // assertBaselineFresh 预检（等效 CLI save 的 __baseline 口径）。
        const landing = payload.content !== undefined ? { ...entry, payload: { ...entry.payload, content } } : entry;
        // baselineKnown 跳过分支：saveModel 内重读磁盘与本进程读取一致 → 不比对
        model.__baseline = null;
        let result;
        try { result = cacheWriteThrough(landing, model); } catch (error) {
          if (error && error.code === 'STORE_CONFLICT') {
            return json(res, 409, { error: 'CONFLICT', message: error.message, store_revision: storeRevision() });
          }
          return json(res, 500, { error: 'IO_FAILED', message: error.message });
        }
        // 持久化次序与 CLI cacheApply 一致：库写成功才标 applied + processed_at。
        const next = entries.slice();
        next[index] = { ...entry, status: 'applied', processed_at: store.timestamp() };
        cache.writeCache(projectRoot, next);
        const applied = { ...next[index] };
        return json(res, 200, { applied: true, record_id: result.record_id, entry: applied, snapshot: buildSnapshot() });
      } finally { storeLease.release(); }
    } catch (error) {
      return json(res, 500, { error: 'IO_FAILED', message: error.message });
    } finally { cacheLease.release(); }
  }

  /**
   * POST /api/cache/<event_id>/discard：仅 pending → discarded，持 cache.lock、
   * 锁内重读防竞态；applied 409；重复 discard 幂等 200。只写 cache.jsonl。
   */
  async function discardCacheEntry(req, res, eventId) {
    const payload = await readJsonPostBody(req, res, ['store_revision']);
    if (!payload) return;
    if (typeof payload.store_revision !== 'string' || !payload.store_revision) {
      return json(res, 400, { error: 'VALIDATION', message: '缺少 store_revision' });
    }
    const cacheLease = lock.tryAcquireLock(cacheFile.lock);
    if (!cacheLease) return json(res, 503, { error: 'LOCK_BUSY', message: 'cache.lock 正被其他进程持有；稍后重试' });
    try {
      const entries = cache.readCache(projectRoot);
      const index = entries.findIndex((entry) => entry.event_id === eventId);
      if (index < 0) return json(res, 404, { error: 'NOT_FOUND', message: `不存在 cache 条目: ${eventId}` });
      const entry = entries[index];
      if (entry.status === 'applied') {
        return json(res, 409, { error: 'CONFLICT', message: `cache 条目已落库，不能再丢弃: ${eventId}` });
      }
      if (entry.status !== 'discarded') {
        const next = entries.slice();
        next[index] = { ...entry, status: 'discarded', processed_at: store.timestamp() };
        cache.writeCache(projectRoot, next);
      }
      // 已是 discarded：幂等 200，不重复写。
      return json(res, 200, { applied: true, snapshot: buildSnapshot() });
    } catch (error) {
      return json(res, 500, { error: 'IO_FAILED', message: error.message });
    } finally { cacheLease.release(); }
  }

  /**
   * POST /api/cache/prune：语义同 CLI cachePrune——清 applied|discarded|读时
   * stale 条目，时效起点 processed_at||created_at，持 cache.lock。
   */
  async function pruneCacheEntries(req, res) {
    const payload = await readJsonPostBody(req, res, ['store_revision', 'older_than_days']);
    if (!payload) return;
    if (typeof payload.store_revision !== 'string' || !payload.store_revision) {
      return json(res, 400, { error: 'VALIDATION', message: '缺少 store_revision' });
    }
    let days = null;
    if (payload.older_than_days !== undefined) {
      days = payload.older_than_days;
      if (!Number.isSafeInteger(days) || days < 0) {
        return json(res, 400, { error: 'VALIDATION', message: 'older_than_days 必须是非负整数' });
      }
    }
    const cacheLease = lock.tryAcquireLock(cacheFile.lock);
    if (!cacheLease) return json(res, 503, { error: 'LOCK_BUSY', message: 'cache.lock 正被其他进程持有；稍后重试' });
    try {
      const entries = cache.readCache(projectRoot);
      let model = null;
      try { model = store.parseStore(fs.readFileSync(paths.memory, 'utf8')); } catch { model = null; }
      const versions = model ? new Map(model.records.map((record) => [record.id, ledger.recordVersion(record)])) : null;
      const derived = cache.deriveStale(entries, versions);
      const cutoff = days === null ? null : Date.now() - days * 86400000;
      const kept = [];
      let removed = 0;
      for (const [index, entry] of entries.entries()) {
        // stale 是读时派生态，不写回磁盘；判定只用于决定是否清理。
        const processed = entry.status === 'applied' || entry.status === 'discarded' || derived[index].stale === true;
        const since = entry.processed_at || entry.created_at;
        const oldEnough = cutoff === null || Date.parse(since) <= cutoff;
        if (processed && oldEnough) removed += 1;
        else kept.push(entry);
      }
      if (removed) cache.writeCache(projectRoot, kept);
      return json(res, 200, { removed, snapshot: buildSnapshot() });
    } catch (error) {
      return json(res, 500, { error: 'IO_FAILED', message: error.message });
    } finally { cacheLease.release(); }
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
    // 三条 cache 路由：与 PATCH 相同的 Host + 令牌前置检查，安检链在各自
    // handler 内照 patchRecord 顺序执行。
    const cacheMatch = url.pathname.match(/^\/api\/cache\/([a-f0-9]{32})\/(apply|discard)$/);
    if (cacheMatch && req.method === 'POST') {
      if (!tokenOk(req)) return json(res, 401, { error: 'UNAUTHORIZED', message: '缺少或错误的访问令牌；请使用本次启动输出的地址' });
      const handler = cacheMatch[2] === 'apply' ? applyCacheEntry : discardCacheEntry;
      return handler(req, res, cacheMatch[1]).catch((error) => json(res, 500, { error: 'IO_FAILED', message: error.message }));
    }
    if (url.pathname === '/api/cache/prune' && req.method === 'POST') {
      if (!tokenOk(req)) return json(res, 401, { error: 'UNAUTHORIZED', message: '缺少或错误的访问令牌；请使用本次启动输出的地址' });
      return pruneCacheEntries(req, res).catch((error) => json(res, 500, { error: 'IO_FAILED', message: error.message }));
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'NOT_FOUND', message: '未知接口' });
    // No arbitrary file service: everything outside the page and the API 404s.
    return json(res, 404, { error: 'NOT_FOUND', message: '不存在该资源' });
  });

  return { server, paths, storeRevision, buildSnapshot };
}
