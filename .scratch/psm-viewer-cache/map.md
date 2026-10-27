# Map: PSM viewer 管理 cache 暂存区

Label: wayfinder:map
Effort: psm-viewer-cache
Created: 2026-10-27

## Destination

实现 `.scratch/psm-viewer-cache/spec.md`(Triage: ready-for-agent):查看器 `view-memoery.js` 新增暂存区面板,管理 cache 候选(查看、编辑后并入、丢弃、清理),与 CLI 共用写入语义与安全模型。产出为一个堆叠 PR(base `fix/project-self-memory-discussion`)。

## Notes

- 本图为实施图(全部 Type: task),非 grilling 图;决策已固化在 spec 的 Implementation Decisions,工单只拆分与落位,不开新设计分叉。
- 依赖与状态约定见 `docs/agents/issue-tracker.md`:执行状态 `open/claimed/resolved`,`Blocked by:` 顶部行,frontier = 首个 open 且无未解决依赖的工单。
- 现场事实(2026-10-27,HEAD `5426028`,只读复核到行级):
  - 构建器 shebang 缺陷实锤:`scripts/build-viewer.mjs:76` 正则 `/^#!.*\n/` 在 CRLF 源上失配(`.*` 不匹配 `\r`),shebang 残留进 5 个工厂体;本机 `core.autocrlf=true`,仓库无 `.gitattributes`。实测 `tests/viewer-server.test.mjs` 19 项中 14 失败 / 5 通过(spec 写「6 项」过时;失败全是产物 line 31 SyntaxError)。`--check`(L189-199)只比字节,对「坏而一致」盲,且确认零写调用可安全执行。
  - 跨模块导入:`scripts/memory-cache.mjs:19` `import { TYPES } from './memory-store.mjs'` 是构建模块中唯一的相对导入;构建器 IMPORTS(L36-44)仅支持 node: 内置,无相对导入通道。定案:工厂体注入 `const { TYPES } = deps;`,入口硬接线传 `store.TYPES`(与 L122-127 手写接线风格一致)。
  - 服务端:`scripts/viewer-server.mjs` deps 解构 L19-20 无 cache;`buildSnapshot` L54-116 无 cache 节;`patchRecord` L144-176 是安检链模板(Origin 403 → Content-Type 415 → 限长 413/400 → JSON 400 → 白名单 400 → 业务 400 → 非阻塞锁 503 → store_revision 409 → 只读守卫 422 → 404 → 契约 400 → 字节无变化短路 → 重 parse 守卫 500 → 备份失败 500 → 原子替换 → 200 带新快照);路由表 L239-267;错误 JSON 统一 `{ error, message }`。`storeRevision()` L47-51 口径不动。
  - CLI 落库语义(服务端复刻,`scripts/memory.mjs`):`cacheApply` L698-724(失效判定 L713-717:记录不存在或 `recordVersion` ≠ `target_record_version` → `PSM_CONFLICT`)、`cacheWriteThrough` L727-776(add→`newId` 游标+评分归零;update→正文变更+评分投影重置;delete→records 过滤;±1→kind 归一化+`assertBaselineFresh`+`appendEvent(event_id='cache-apply-'+event_id)` 幂等键→save 内 syncProjections)、`cacheMarkDiscarded` L673-686(仅 pending,applied 拒,重复幂等)、`cachePrune` L778-802(processed = applied|discarded|读时 stale;时效起点 processed_at||created_at)、`cacheList` L641-655(pending→deriveStale→groupEntries→每组附 current{exists,record_version,content,type})。
  - cache 原语(`scripts/memory-cache.mjs`):`readCache`(缺失=[])、`writeCache`(须持 cache.lock,temp+rename 原子)、`deriveStale`(L204-212,versions 不可得→stale:null 不猜)、`groupEntries`(L221-247)、`parseCache` 畸形 fatal。
  - 锁(`scripts/memory-lock.mjs`):`tryAcquireLock` L80-84 非阻塞 busy=null;`tryAcquireStoreLocks` L90-97 memory→evidence 失败回滚。锁序铁律 `cache.lock → memory.lock → evidence.lock`,不重入(`memory.mjs:548-549`)。
  - 页面(`scripts/viewer-page.mjs`,744 行):工具栏 L135-160、els 注册表 L217-226、监听 L702-729;面板 `.hidden` toggle + 窄屏 `@media 767px` 全屏;全部 textContent 渲染零 innerHTML;徽标先例 `.pill`/`.tag-chip`;错误文案先例 L682-693;acceptSnapshot L259-268。**页面源码在模板字符串内:禁反引号、禁 `</script>`、正则 `\n` 写 `\\n`**。
  - 测试 seam(`tests/viewer-server.test.mjs`):mkdtemp+init+覆写 memory.md(L14-17, 67-72)、`startViewer` L24-45(spawn 部署产物,抓 `PSM_VIEWER_URL`)、`api()` L47-58(Bearer 自动附)、`startSourceViewer` L408-428 源码旁路。CLI 用例已有 `tests/memory-cache.test.mjs`,本卡不新增 CLI 用例。注意:测试套件 L297 用例会重写 viewer-dist(字节幂等,预期)。
- 已锁定的约束(各卡不得重开):
  1. CLI 行为零改动;`cache.jsonl` 格式与版本不变。
  2. `store_revision` 口径不变(仍只哈希 memory.md + evidence.jsonl;cache-only 变更不触发主库 409)。
  3. 锁序 `cache.lock → memory.lock → evidence.lock`,HTTP 侧全部非阻塞、忙即 503。
  4. 失效候选拒直写(409);写入成功前条目保持 pending;stale 永不落盘、pending 永不自动过期。
  5. 查看器不提供「新建候选」。
  6. 产物 `viewer-dist/view-memoery.js` 与 `manifest.json` 由构建器生成、随构建入库;合并永不手工文本编辑产物。
  7. 新增测试一律走部署产物 + HTTP 黑盒,断言状态码/JSON 结构/磁盘文件;每用例前附中文 GWT 注释(仓库测试规范)。
- 文档同步点(T4):`references/viewer.md`(路由表 L22-26、写入管线 L44-50、并发 L64-68)、`SKILL.md:40` 段末、skill `README.md:48` 段末、根 `README.md:815-827`、`.claude-plugin/marketplace.json:123-129`(version 2.6.0→2.7.0)。
- 工作区遗留:主 checkout 的 viewer-dist 未提交改动 = 坏产物,由 T1 重建覆盖,不单独处理。

## Decisions so far

<!-- 一行一张已完成的工单:标题链接 + 一句话结论 -->

- [01 修复构建器 shebang 缺陷并接入 cache 模块](issues/01-builder-shebang-and-cache-module.md):shebang 正则改 `/^#!.*\r?\n/`;MODULES 接入 cache + TYPES 经 deps 注入;复现性用例补产物 `node --check` 防线;产物重建,viewer-server 测试 19 项全绿。
- [02 server:快照 cache 节与三条 POST 路由](issues/02-server-cache-snapshot-and-routes.md):快照 cache 节按冻结 schema 落地(apply 响应增量多带 entry 字段);apply/discard/prune 照 patchRecord 安检链,锁序 cache.lock→memory.lock+evidence.lock 全非阻塞;9 类新用例,28/28 全绿、全套件 159 项无连带破坏。坑:appendEvent 自持阻塞锁与路由非阻塞锁死锁,内联复刻其幂等语义绕开。
- [03 页面:暂存区面板](issues/03-page-staging-panel.md):工具栏「暂存区」按钮 + pending 徽标,按组渲染(修订原/新对照、失效双对照只给丢弃、证据网格),全 textContent 零 innerHTML;成功走 acceptSnapshot 整刷,失败保留草稿;38 项 DOM 断言 + 真浏览器截图冒烟通过。简化(工单允许):prune 不带天数、丢弃无确认、面板与编辑器并列不互斥。
- [04 文档同步(AGENTS.md 清单)](issues/04-docs-sync.md):viewer.md 补三条路由与 cache 写入管线/并发语义;SKILL.md、skill README、根 README 各补暂存区一句;marketplace PSM 描述补暂存区、version 2.6.0→2.7.0;JSON.parse 与断链校验通过。偏差(以实现为准):prune 可选 older_than_days、discard 409/幂等 200 均按实现补写。
- [05 产物行尾漂移](issues/05-artifact-eol-drift.md):构建器三处行尾归一化(模块源、入口模板、--check 比对),产物确定纯 LF;新增混合行尾源字节稳定用例;顺带修复 manifest 缺 HEAD 产物哈希导致 fresh checkout 误判本地修改的问题。全套件 160/160。

## Out of scope

- 查看/编辑 `evidence.jsonl` 账本(spec 已排除)。
- 查看器内新建 cache 候选。
- CLI 行为、cache.jsonl 格式、store_revision 口径、cache TTL 的任何变更。
- 合并同类候选、批量 apply 等策展增强。
