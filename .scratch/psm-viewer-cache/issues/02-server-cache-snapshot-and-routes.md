Status: resolved
Type: task
Blocked by: 01
Map: ../map.md

# 02 server:快照 cache 节与三条 POST 路由

## Answer

### 改动内容

只动 `viewer-server.mjs` 与 `tests/viewer-server.test.mjs`;另因 T1 入口接线未传 `cache`,在 `build-viewer.mjs` 接线对象补了 `cache,` 一行(否则部署产物拿到 `cache === undefined`,快照降级为空节)。**未动 viewer-page.mjs / memory.mjs / memory-cache.mjs;`storeRevision` 函数零改动。**

- **A. 快照 cache 节**(冻结 schema):`buildSnapshot` 追加顶层 `cache: buildCacheSection(model, diagnostics)`。`readCache`(缺失视为空)→ 过滤 pending → `deriveStale`(versions 用快照已解析模型遍历 records 取 `ledger.recordVersion`;`model=null` 时传 null,stale 全 null 不猜)→ `groupEntries` → 每组附 `current`(对齐 CLI `cacheTargetSnapshot`:add 组恒 `null`;有 refid 但记录不存在 → `exists:false` + 三字段 null)。`count` = pending 条目数。cache.jsonl 损坏时降级空节 + `kind:'cache'` warning 诊断,不阻断快照。`store_revision` 口径不变。
- **B. 路由注册**:deps 解构增加 `cache`;`POST /api/cache/:id/apply|discard`(event_id 白名单 `[a-f0-9]{32}`)与 `POST /api/cache/prune`,均先过全局 Host 检查 + `tokenOk`(401),handler 内照 patchRecord 安检链:Origin 同源(403 ORIGIN_REJECTED)→ Content-Type(415)→ 限长读体(413/400 BAD_BODY)→ JSON(400 BAD_JSON)→ 字段白名单(400 BAD_FIELDS,各自独立:apply `store_revision+content`、discard `store_revision`、prune `store_revision+older_than_days`)→ 业务校验(400 VALIDATION)→ 非阻塞取锁(忙 503 LOCK_BUSY)→ 404 → 422 READ_ONLY → 409 → CONTRACT → 写入 → 200。
- **锁序**:apply `cache.lock → memory.lock + evidence.lock`(`tryAcquireStoreLocks`),任一忙释放已持锁并 503;discard/prune 只持 `cache.lock`。全非阻塞。
- **C. apply**:404 精确匹配;持 cache.lock 后重读确认仍 pending(非 pending 409,TOCTOU 防护);op 非 add/update 带 content → 400 VALIDATION(工单冻结决定,已固化进测试);提交正文 = 请求 content 改写版否则条目暂存版,落库前过 `contentContractErrors`(400 CONTRACT);持 store 锁后重 parseStore,只读守卫 422;失效守卫 409(message 含「原基准 vs 现状」);store_revision 陈旧 409(响应附当前值)。`cacheWriteThrough` 复刻 CLI 语义(复用 store/ledger 原语,未 import CLI 函数):add→游标 newId+push(active、评分归零);update→改正文+投影重置;delete→过滤;±1→kind 归一化+task_id 合法 source 否则 'cache'+assertBaselineFresh+账本事件(键 `cache-apply-<event_id>` 与 CLI 同键;因已持 evidence.lock,不能用自取阻塞锁的 `ledger.appendEvent`,用其导出原语按 appendEvent 幂等语义内联复刻,observed_at 不参与幂等比较)。持久化次序与 CLI cacheApply 一致:save 全成功才标 applied+processed_at 并 writeCache;±1 duplicate 按幂等成功处理。`saveModel` 复刻 CLI save:全量校验→syncProjections→基线比对(口径同 CLI,持锁刚读即跳过)→serialize→备份→原子替换,失败抛出前条目保持 pending。响应 200:`{ applied:true, record_id, entry, snapshot }`。
- **D. discard**:pending→discarded(processed_at);applied 409;重复 discard 幂等 200;只写 cache.jsonl,不碰主库、零备份。响应 `{ applied:true, snapshot }`。
- **E. prune**:语义同 CLI cachePrune——清 applied|discarded|读时 stale,时效起点 `processed_at||created_at`,持 cache.lock,`older_than_days` 可选非负整数。响应 `{ removed, snapshot }`。
- **F. 测试**:9 个新用例全部走部署产物 + HTTP 黑盒(既有 seam),每用例前中文 GWT 注释(见 tests L549-887)。

### 验收结果

1. `node --test skills/project-self-memory/tests/viewer-server.test.mjs` → **28 项全绿**(19 旧 + 9 新)。
2. `node skills/project-self-memory/scripts/build-viewer.mjs` 重建产物(新 sha `cdb411730927…`,manifest 追加),`--check` → `PSM_VIEWER_CONSISTENT`;`node --check` 产物可解析。
3. 全套件 `node --test skills/project-self-memory/tests/*.test.mjs` → 159 项全绿(memory-cache、viewer-deploy 等无连带破坏)。

### 与冻结 schema 的偏差

- 响应体在工单要求的 `{ applied, record_id, snapshot }` 之外多带一个 `entry` 字段(落库后的条目对象),纯增量,03 可忽略;其余字段与工单一致。prune/discard 响应与工单逐字一致。
- schema 本体(`cache.count/groups[].key/kind/refid/stale/conflict/count/entries/current`)零偏差;add 组 `current:null`、失效组 `stale:true`、目标缺失 `exists:false` 均按冻结版实现。

### 备注(坑)

- **`ledger.appendEvent` 与路由锁互斥**:它内部自取阻塞式 evidence.lock,而 apply 路由已持非阻塞 evidence.lock,直接调用必然 15s 锁超时。已用 `readLedger` + `fs.appendFileSync` + 幂等比较内联复刻(语义对齐 appendEvent,含 observed_at 豁免)。
- **CLI save 的 `baselineKnown` 语义**:CLI 靠 `withBaseline` 在读入时戳基线;server 持锁窗口内重读,`__baseline=null` 等效「本进程就是当前写者」跳过冲突比对。±1 路径 assertBaselineFresh 仍保留二次预检(先写账本后写库的半条事件防护)。
- **±1/delete 条目 `payload` 为 `null`**:apply 的正文契约检查只对 add/update(或显式带 content)执行,直接读 `entry.payload.content` 会 `TypeError`。
- 测试事实修正:同目标的「两条 update 候选 + 目标随后被外部改」会并入 **stale 组**(groupEntries 规则:stale 优先于 target),且组内多修订 `conflict:true`;快照用例按真实分组行为断言。

## Task

只动 `skills/project-self-memory/scripts/viewer-server.mjs` 与 `tests/viewer-server.test.mjs`;**不动 viewer-page.mjs**(03 并行开发,凭本工单冻结的 schema)。规格:`.scratch/psm-viewer-cache/spec.md`「server:快照与三条新路由」节。

### A. 快照新增 cache 节(冻结 schema,03 据此开发)

`buildSnapshot` 追加顶层字段 `cache`(store_revision 口径不变,cache 不参与其计算):

```jsonc
{
  "cache": {
    "count": 3,                    // pending 条目总数(派生前)
    "groups": [                    // groupEntries 的输出,每组追加 current
      {
        "key": "target:0001",      // 原样透传:new:<event_id> | stale:<refid> | target:<refid>
        "kind": "target",          // "new" | "stale" | "target"
        "refid": "0001",           // add 组为 null
        "stale": false,            // 组级;stale 组恒 true
        "conflict": false,         // groupEntries 的冲突判定
        "count": 2,                // 组内条目数
        "entries": [ /* 派生后的完整条目对象,含 cache.jsonl 全部字段 + stale 字段 */ ],
        "current": {               // 目标记录现状;add 组为 null
          "exists": true,
          "record_version": "<64hex>",
          "content": "<当前正文>",
          "type": "experience"
        }
      }
    ]
  }
}
```

- 读路径复用:`readCache`(文件缺失视为空、不报诊断)→ 派生 versions(用快照已解析的记忆库模型:遍历 records 取 `recordVersion`;**store 不可读/read_only 时 versions 传 null**,deriveStale 全部 `stale:null` 不猜)→ `deriveStale` → `groupEntries` → 每组附 `current`(对齐 CLI `cacheList` memory.mjs L585-589;refid 在模型中查不到则 `exists:false`、record_version/content/type 为 null)。
- `count` = pending 条目数(03 只消费 count 与 groups)。

### B. deps 与路由注册

- `createViewerServer` deps 解构(L19-20)增加 `cache`(构建器接线由 01 完成)。
- 路由表(L239-267)新增三条,全部先过全局 Host 检查与 `tokenOk`(401),再照 `patchRecord` 安检链:Origin 同源(写方法,403 ORIGIN_REJECTED)→ Content-Type application/json(415)→ 限长读体(413/400)→ JSON 合法(400 BAD_JSON)→ **字段白名单(400 BAD_FIELDS)** → 业务校验(400 VALIDATION)→ 非阻塞取锁(忙 503 LOCK_BUSY)→ 只读守卫(422 READ_ONLY)→ 路径目标存在性(404 NOT_FOUND)→ 契约(400 CONTRACT)→ 写入 → 200。错误 JSON 统一 `{ error, message }`。
- **apply 的锁序(与 CLI 一致且非阻塞)**:`cache.lock → memory.lock + evidence.lock`(后两者用 `tryAcquireStoreLocks`);任一忙立即释放已持锁并 503。discard/prune 只持 `cache.lock`。

### C. `POST /api/cache/<event_id>/apply`

请求体白名单恰好两个键:`{ "store_revision": "<当前值>", "content": "<可选改写正文>" }`。

- 目标条目:`readCache` 后按 event_id 精确匹配;不存在 404。
- 非 pending → 409(已落库拒绝,与 CLI 一致);stale 派生为 true 或目标记录不存在 → 409(失效拒直写,message 说明「原基准 vs 现状」理由);store_revision 陈旧 → 409(响应附当前 store_revision)。
- 提交正文 = 请求 `content` 改写版(存在时),否则条目 payload.content;落库这一刻过 `contentContractErrors`,违例 400 CONTRACT。**决定(实现时固化进测试)**:op 非 add/update 时请求带了 content → 400 VALIDATION。
- 写入复刻 CLI `cacheWriteThrough`(memory.mjs L727-776;只复用 store/ledger 原语,不 import CLI 函数):add→`newId` 游标取新 id + push(status active、评分归零);update→定位记录改 content + 评分投影重置(positive=0/negative=0/last_scored_at='');delete→records 过滤;±1→kind 归一化(evidence.kind 与方向兼容则沿用,否则 human_positive/human_negative)+ task_id 取合法 source 否则 'cache' + `assertBaselineFresh` + `appendEvent({ event_id: 'cache-apply-' + entry.event_id, ... })`(账本幂等键与 CLI 同键)→ save(内部 syncProjections 刷投影)。
- **持锁后重读磁盘**(对齐 patchRecord 的锁内重 parse 模式,防 TOCTOU):持锁后重 readCache 确认条目仍 pending、重 parseStore 确认目标记录现状,再套用上述守卫。
- **持久化次序(与 CLI cacheApply 一致)**:库写入(save)全部成功后,才把条目标 `status:'applied'` + `processed_at` 并 `writeCache`;任何失败先于持久化返回,条目保持 pending。±1 的 appendEvent 返回 duplicate 时按幂等成功处理(继续 save 与标 applied)。
- 响应 200:`{ "applied": true, "record_id": "<新或目标 id>", "snapshot": <完整新快照> }`(03 用响应快照整体刷新)。

### D. `POST /api/cache/<event_id>/discard`

请求体 `{ "store_revision": "<当前值>" }`(只为复用统一安检链;cache-only 变更不做比对,不带 409 语义)。

- 仅 pending → discarded(持 cache.lock、锁内重读防竞态;applied 409;重复 discard 幂等 200);只写 cache.jsonl,不碰主库、不产生备份。
- 响应 200:`{ "applied": true, "snapshot": <完整新快照> }`。

### E. `POST /api/cache/prune`

请求体 `{ "store_revision": "<当前值>", "older_than_days": <可选 int ≥0> }`。

- 语义同 CLI `cachePrune`(memory.mjs L778-802):清 applied|discarded|读时 stale 条目;时效起点 processed_at||created_at;持 cache.lock。
- 响应 200:`{ "removed": <n>, "snapshot": <完整新快照> }`。

### F. 测试(走部署产物 + HTTP 黑盒,每用例前附中文 GWT 注释)

沿用 `tests/viewer-server.test.mjs` 既有 seam(mkdtemp + init + spawn 部署产物 + `api()`);造候选用 CLI(`cache add`,正文走 `--content-file`)。至少覆盖:

1. 快照 cache 节:分组(new 独立成组/同目标成组)、失效标记(改目标正文后出现 stale 组,current 为新正文)。
2. apply add:200、memory.md 出现新记录(断言磁盘)、条目转 applied(快照 count 减少)。
3. apply update 带 content 改写:正文为改写版、评分投影重置;多行正文 400 CONTRACT。
4. 失效候选 apply:409 且条目保持 pending(再读快照仍在)。
5. discard 状态机:pending 可、applied 409、重复 discard 幂等。
6. ±1 apply:evidence.jsonl 出现 `cache-apply-<event_id>` 事件、记录评分字段更新;重复 apply 不产生第二条事件(幂等)。
7. 安检:无令牌 401、跨 Origin 403、未知字段 400、锁忙 503(外部先持 cache.lock)。
8. prune:清已处理、留 pending;带 older_than_days 时新建的已处理条目保留。
9. store_revision 口径:discard/prune 后,携带旧 store_revision 的记录 PATCH 仍成功(证明 cache-only 变更不触发主库 409)。

## Comments

- 检查点:不动 viewer-page.mjs;不动 memory.mjs / memory-cache.mjs;`storeRevision` 函数零改动。
