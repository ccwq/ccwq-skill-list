# 紧凑查看器（view-memoery.js）

`.project-self-memory/view-memoery.js` 是自包含单文件查看器：只用 Node 内置模块，不访问网络，只监听 127.0.0.1。文件名 `view-memoery.js` 是固定拼写，不要改成 `view-memory.js`。

## 启动与令牌

```text
node .project-self-memory/view-memoery.js [--port N] [--no-open]
```

- 启动后输出 `PSM_VIEWER_URL: http://127.0.0.1:<port>/#token=<hex>`。
- 默认用系统默认浏览器打开带令牌的地址，打开失败不致命；加 `--no-open` 或设 `PSM_VIEWER_OPEN=0` 禁止（无头环境、远程终端使用）。
- 令牌是 ≥256-bit 随机 hex，经 URL fragment 交接；页面把它暂存进 `sessionStorage`（标签页级，关闭即清）并立刻从地址栏移除。
- 令牌只存在于进程内存与页面会话中，不写入磁盘，不进入请求 URL、Referer 或历史记录。
- 刷新同一标签页不需要重新复制令牌；新标签页必须重新带 `#token=` 打开。
- 记忆目录固定为脚本所在目录内最近一层的 `.project-self-memory/`，与启动时的工作目录无关。脚本在 `.project-self-memory/` 内（部署位置）或项目根（手动复制）启动均可；复制到别处即查看别处的库。

## HTTP 契约

| 路由 | 方法 | 说明 |
|---|---|---|
| `/` | GET | 单页 HTML；`Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'`，`Cache-Control: no-store`，`Referrer-Policy: no-referrer`，`X-Content-Type-Options: nosniff` |
| `/api/snapshot` | GET | 返回 `{store_revision, read_only, diagnostics, groups, records[]}`；每条记录含投影后的 `positive`、`negative`、`event_count`、`score_event_count`、`freshness` 与当前 `record_version` |
| `/api/records/<id>` | PATCH | 仅接受 `{store_revision, content, type, status}` 四字段；一次提交三字段原子生效 |

请求规则：

- 除 `/` 外必须带 `Authorization: Bearer <token>`，否则 401。
- Host 必须在白名单（127.0.0.1 / localhost，任意端口），否则 403。
- 写请求带 `Origin` 时必须同源，否则 403；`Content-Type` 必须是 `application/json`，否则 415；正文 ≤256KB；未知字段 400。
- 不提供任意文件服务；未知路径 404。

## 写入管线

PATCH 依次执行：字段白名单 → `editGuard`（拒绝结构标记、非法类型/状态、空正文）→ 非阻塞取锁（`memory.lock` → `evidence.lock`，忙即 503，不阻塞事件循环）→ `store_revision` 比对（`memory.md` + `evidence.jsonl` 原始字节 SHA-256，陈旧即 409，页面保留草稿）→ 全量校验失败即 422 只读 → 字节无变化返回 `applied:false`（不备份、不写盘）→ 备份到 `backups/`（失败即 500 `BACKUP_FAILED`，不提交）→ 同目录临时文件原子替换。

损坏的库（未知结构元素、账本校验失败）自动进入 `read_only`，PATCH 一律拒绝，原文件逐字节不变。

## 部署与升级契约

- `init` 首次部署查看器；重复 `init` 保留现状，不升级。
- `viewer install` 显式安装，幂等。
- `viewer update` 只在现有文件整文件 SHA-256 命中官方 `viewer-dist/manifest.json` 时替换；本地修改与符号链接一律拒绝，不信任文件自报版本。
- `viewer status` 输出 `{exists, official, up_to_date}`。
- 产物由 `node scripts/build-viewer.mjs` 确定性生成；`--check` 校验产物与源码一致（漂移退出 1）。

## 备份增长

每次实际写入在 `.project-self-memory/backups/` 留一份 `memory-<时间戳>-<pid>-<随机>.md`。无变化保存不产生备份。目录只增不减；需要清理时手动删除旧文件即可，不影响运行。

## 并发限制

- 查看器与当前 CLI 共用 `memory.lock`/`evidence.lock`，写操作互斥；CLI 侧有限等待，HTTP 侧立即 503。
- 旧版外部工具若直接编辑 `memory.md` 不经过锁，查看器无法感知；保存时的 `store_revision` 比对（409）是最后防线。
- 评分事件绑定当前 `record_version`：编辑正文/类型/状态后旧评分不再投影，记录显示「未评分」，这是设计行为。
