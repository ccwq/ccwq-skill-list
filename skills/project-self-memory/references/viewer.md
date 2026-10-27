# 紧凑查看器（view-memoery.js）

`.project-self-memory/view-memoery.js` 是自包含单文件查看器：只用 Node 内置模块，不访问网络，只监听 127.0.0.1。文件名 `view-memoery.js` 是固定拼写，不要改成 `view-memory.js`。

## 启动与令牌

```text
node .project-self-memory/view-memoery.js
```

启动参数与环境变量统一见[根 README](../../../README.md#project-self-memory)。

- 启动后输出 `PSM_VIEWER_URL: http://127.0.0.1:<port>/#token=<hex>`。
- 默认用系统默认浏览器打开带令牌的地址，打开失败不致命；无头环境、远程终端可按根 README 关闭自动打开。
- 令牌是 ≥256-bit 随机 hex，经 URL fragment 交接；页面把它暂存进 `sessionStorage`（标签页级，关闭即清）并立刻从地址栏移除。
- 令牌只存在于进程内存与页面会话中，不写入磁盘，不进入请求 URL、Referer 或历史记录。
- 刷新同一标签页不需要重新复制令牌；新标签页必须重新带 `#token=` 打开。
- 记忆目录固定为脚本所在目录内最近一层的 `.project-self-memory/`，与启动时的工作目录无关。脚本在 `.project-self-memory/` 内（部署位置）或项目根（手动复制）启动均可；复制到别处即查看别处的库。

## HTTP 契约

| 路由 | 方法 | 说明 |
|---|---|---|
| `/` | GET | 单页 HTML；`Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'`，`Cache-Control: no-store`，`Referrer-Policy: no-referrer`，`X-Content-Type-Options: nosniff` |
| `/api/snapshot` | GET | 返回 `{format, store_revision, read_only, diagnostics, groups, group_dimension, generated_at, taxonomy, records[]}`；`format` 为 `psm-viewer-snapshot-v2`；每条记录含只读派生 `tags`、投影后的 `positive`、`negative`、`event_count`、`score_event_count`、`freshness` 与当前 `record_version`；另带只读 `cache` 节 `{count, groups[]}`（pending 计数与分组），组字段 `key`/`kind`/`refid`/`stale`/`conflict`/`count`/`entries`/`current` |
| `/api/records/<id>` | PATCH | 仅接受 `{store_revision, content, type, status}` 四字段；一次提交三字段原子生效 |
| `/api/cache/<event_id>/apply` | POST | 编辑并入：把一条 pending 候选落库；可带改写后正文（仅 add/update 接受 `content`） |
| `/api/cache/<event_id>/discard` | POST | 丢弃：pending → discarded；已 applied 拒绝（409），重复 discard 幂等 200 |
| `/api/cache/prune` | POST | 清理：清 applied、discarded 与读时已失效条目，可选 `older_than_days` 非负整数 |

请求规则：

- 除 `/` 外必须带 `Authorization: Bearer <token>`，否则 401。
- Host 必须在白名单（127.0.0.1 / localhost，任意端口），否则 403。
- 写请求带 `Origin` 时必须同源，否则 403；`Content-Type` 必须是 `application/json`，否则 415；正文 ≤256KB；未知字段 400。
- cache 路由同样要求 Bearer 令牌（401）、Host 白名单、Origin 同源、JSON 限长与字段白名单（apply `{store_revision, content?}`、discard `{store_revision}`、prune `{store_revision, older_than_days?}`）。
- 不提供任意文件服务；未知路径 404。

## 标签筛选与分组

- 每次快照读取项目 `tags.json` 并派生标签；顶层 `taxonomy` 为 `{version: 1, tags: [...]}`，不传输逐记录 `overrides`，其效果已体现在记录 `tags` 中。
- 标签多选按任一匹配筛选；未选择标签时保留无标签记录。按标签视图以首个标签分桶，其余标签显示为芯片；无标签归入「未标记」。存储 `group` 视图继续可用，不改写旧分组。
- 列表与详情标签只读；编辑表单仍仅提交正文、类型、状态及版本令牌。PATCH 未新增 `tags`、`taxonomy` 或 override 字段，提交这些字段仍为 400。
- 缺少或空白 taxonomy 时仍识别正文行首 `[key=value]` 与 `[key=v1,v2]`；文件非法时关闭所有标签并在快照 `diagnostics` 报 warning，不单独触发 `read_only`。规则见 [memory-format.md](memory-format.md)。
- GET 快照不写正文、账本或 taxonomy。taxonomy 不参与 `store_revision`（仍只哈希 `memory.md` 与 `evidence.jsonl`）或 `record_version`；修改分类标准不会使评分证据失效。
- 新页面将旧快照缺少的 `tags` 视为空数组；旧版查看器忽略旁路 `tags.json`，保持原有行为。已部署项目需升级官方查看器并重启才能使用标签 UI；部署源码与分发产物同步由构建流程负责。

## 写入管线

PATCH 依次执行：字段白名单 → `editGuard`（拒绝结构标记、非法类型/状态、空正文）→ **单行契约**（正文与磁盘不一致时执行；拒绝内部换行、Unicode 行/段分隔符与标题/列表/围栏开头，400 `CONTRACT`）→ 非阻塞取锁（`memory.lock` → `evidence.lock`，忙即 503，不阻塞事件循环）→ `store_revision` 比对（`memory.md` + `evidence.jsonl` 原始字节 SHA-256，陈旧即 409，页面保留草稿）→ 全量校验失败即 422 只读 → 字节无变化返回 `applied:false`（不备份、不写盘）→ 备份到 `backups/`（失败即 500 `BACKUP_FAILED`，不提交）→ 同目录临时文件原子替换。

单行契约只约束**实际变化**的正文：重新提交记录自身的多行正文（用于只改类型/状态）仍然合法，与 CLI 的 no-op 语义一致。查看器只校验人工提交的最终正文，不做语义改写；历史多行记录保持可读。规则见 [expression-contract.md](expression-contract.md) 与 [memory-format.md](memory-format.md)。

损坏的库（未知结构元素、账本校验失败）自动进入 `read_only`，PATCH 一律拒绝，原文件逐字节不变。

### cache 写入管线

`apply`（编辑并入）走两条锁：非阻塞先取 `cache.lock`（忙即 503），持锁后重读确认条目仍 pending（非 pending 409）；再取 `memory.lock + evidence.lock`（忙即 503）。库损坏一律 422 只读，条目保持 pending。改写正文在落库这一刻过单行契约（400 `CONTRACT`）；落库前做失效守卫——目标记录不存在或 `record_version` 与候选基准不一致（原基准 vs 现状）时拒绝直写（409）。请求携带的 `store_revision` 陈旧同样 409。±1 候选写账本走幂等键 `cache-apply-<event_id>`；库写入全部成功后才把条目标为 `applied`，此前条目保持 pending。

`discard` 与 `prune` 只写 `cache.jsonl`、只持 `cache.lock`，不触碰记忆库与账本。cache-only 变更（discard、prune）不改变 `store_revision`（其口径仍只哈希 `memory.md` 与 `evidence.jsonl`），因此不会触发其他写方的记录编辑 409。

## 部署与升级契约

- `init` 首次部署查看器；重复 `init` 保留现状，不升级。
- `viewer install` 显式安装，幂等。
- `viewer update` 只在现有文件整文件 SHA-256 命中官方 `viewer-dist/manifest.json` 时替换；本地修改与符号链接一律拒绝，不信任文件自报版本。
- `viewer status` 输出 `{exists, official, up_to_date}`。
- 产物由 `node scripts/build-viewer.mjs` 确定性生成；`--check` 校验产物与源码一致（漂移退出 1）。

## 备份增长

每次实际写入在 `.project-self-memory/backups/` 留一份 `memory-<时间戳>-<pid>-<随机>.md`。无变化保存不产生备份。目录只增不减；需要清理时手动删除旧文件即可，不影响运行。

## 并发限制

- 查看器与当前 CLI 共用 `memory.lock`/`evidence.lock`，写操作互斥；CLI 侧有限等待，HTTP 侧立即 503。cache 路由同样非阻塞取锁，`cache.lock` 或库锁被占时立即 503。
- 旧版外部工具若直接编辑 `memory.md` 不经过锁，查看器无法感知；保存时的 `store_revision` 比对（409）是最后防线。
- 评分事件绑定当前 `record_version`：编辑正文/类型/状态后旧评分不再投影，记录显示「未评分」，这是设计行为。
