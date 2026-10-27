Status: resolved
Type: task
Blocked by: 02, 03
Map: ../map.md

# 04 文档同步(AGENTS.md 清单)

## Answer

在 worktree(基于 feat/project-self-memory-viewer-cache @ 49df3de)完成,零代码:

1. `skills/project-self-memory/references/viewer.md`:
   - HTTP 契约路由表补三行:`POST /api/cache/<event_id>/apply`(编辑并入)、`POST /api/cache/<event_id>/discard`(丢弃)、`POST /api/cache/prune`(清理已处理/已失效)。
   - 请求规则补一条:cache 路由同样要求 Bearer 令牌(401)、Host 白名单、Origin 同源、JSON 限长(413/400)与字段白名单(apply `{store_revision, content?}`、discard `{store_revision}`、prune `{store_revision, older_than_days?}`)。
   - 写入管线节新增「cache 写入管线」小节:非阻塞锁序 `cache.lock → memory.lock + evidence.lock`(忙 503)、持锁重读确认 pending(非 pending 409)、库损坏 422 只读且条目保持 pending、失效守卫(目标不存在或 record_version 与候选基准不一致,原基准 vs 现状,409 拒直写)、改写正文落库时刻过单行契约 400、store_revision 陈旧 409、±1 走账本幂等键 `cache-apply-<event_id>`、库写入全部成功后才标 applied、discard/prune 只持 cache.lock 只写 cache.jsonl、cache-only 变更不改 store_revision(不触发记录编辑 409)。
   - 并发限制段补:cache 路由同样非阻塞取锁,cache.lock 或库锁被占立即 503。
2. `skills/project-self-memory/SKILL.md` 紧凑查看器段末补:「暂存区可在查看器中查看、编辑并入、丢弃、清理。」
3. `skills/project-self-memory/README.md` 查看器段末补同一句。
4. 根 `README.md` 紧凑查看器段末补同一句(索引表与参数速查未动,本卡无新 CLI 参数)。
5. `.claude-plugin/marketplace.json` project-self-memory:description 补「可在查看器中查看、编辑并入、丢弃与清理暂存区」;version `2.6.0` → `2.7.0`。

收尾校验:

- `.claude-plugin/marketplace.json` 通过 `JSON.parse`(node -e,plugins 共 30 条,version 2.7.0)。
- 路由名与实现一致:viewer-server.mjs 正则 `^\/api\/cache\/([a-f0-9]{32})\/(apply|discard)$` 与固定 `/api/cache/prune`;viewer-page.mjs 前端调用同一组路径。文档占位 `<event_id>` 沿用既有 `/api/records/<id>` 风格。
- 链接无断链:根 README / SKILL / skill README / viewer.md 涉及的相对路径(references/*.md、../../README.md、docs/teach/.../0001-psm-usage-guide.html)逐一核实存在。

与工单的偏差(以实现为准):

- 工单未提 prune 的可选 `older_than_days` 参数;文档按实现补写(非负整数,否则 400 VALIDATION)。
- 工单要求 apply「各一句说明」,实际实现里 discard 对已 applied 条目 409、重复 discard 幂等 200,已并入 discard 路由行说明以保证描述与实现一致。
- 工单行号(L22-26、L28-33 等)基于工单撰写时的 viewer.md;实现分支上 viewer.md 为新文件,按内容对应位置落笔。
- 实现正则要求 event_id 为 32 位十六进制;文档表格用 `<event_id>` 占位、未写格式约束,与既有路由文档风格一致,不构成矛盾。

## Task

只动文档与 marketplace 元数据,零代码。逐项:

1. `skills/project-self-memory/references/viewer.md`:
   - HTTP 契约路由表(L22-26)补三行:`POST /api/cache/<event_id>/apply`、`POST /api/cache/<event_id>/discard`、`POST /api/cache/prune`(各一句说明:编辑并入/丢弃/清理已处理)。
   - 请求规则 bullet 段(L28-33)补:cache 路由同样要求 Bearer 令牌(401)、Host 白名单、Origin 同源、JSON 限长与字段白名单。
   - 写入管线段(L44-50)补 cache 写入语义:非阻塞锁序 `cache.lock → memory.lock + evidence.lock`(忙 503)、非 pending 409、失效候选拒直写 409(原基准 vs 现状)、改写正文落库时刻过单行契约 400、±1 走账本幂等键 `cache-apply-<event_id>`、写入成功前条目保持 pending、discard/prune 只持 cache.lock、cache-only 变更不改 store_revision(不触发记录编辑 409)。
   - 并发限制段(L64-68)补一句 cache 路由同样立即 503。
2. `skills/project-self-memory/SKILL.md` 紧凑查看器段(:40)段末补一句:「暂存区可在查看器中查看、编辑并入、丢弃、清理。」
3. `skills/project-self-memory/README.md` 查看器段落(:42-48)末尾补同一句。
4. 根 `README.md` 紧凑查看器段(:815-827)补同一句(索引表 :63 与参数速查 :650 不动——本卡无新 CLI 参数)。
5. `.claude-plugin/marketplace.json`(:123-129)project-self-memory 条目:description 补「查看器管理暂存区」语义;version `2.6.0` → `2.7.0`(次版本号递增)。
6. 收尾校验(AGENTS.md 同步清单):`.claude-plugin/marketplace.json` 可被 `JSON.parse`;README 详情链接无断链(检查涉及的相对路径真实存在)。

## Comments

- 规格依据:`.scratch/psm-viewer-cache/spec.md`「文档同步(AGENTS.md 清单)」节。
