# 协议与排障

`state-sync.mjs` 的执行管线为：读取环境变量 → 验证动态 URL 与输入 → CDP HTTP discovery → page WebSocket connection → Runtime probe → export/write → navigation/readback → 脱敏摘要。

## CDP API

- `Network.getCookies({ urls: [url] })` 读取当前 URL 范围的 Cookie（包含 `HttpOnly`）。完整迁移依据 domain/path 规划与回读结果确认覆盖范围。
- `Network.setCookies({ cookies })` 写入目标 Cookie。
- `Runtime.evaluate` 合并写入当前标签页的 `localStorage` 与 `sessionStorage`。

## 排障顺序

页面发现失败时，依次检查 `/json/version`、`/json/list` 的 HTTP 连通性，以及动态 URL 是否已在配置的浏览器中打开。

导入失败时，依次核对密码来源、`encrypted: true`、来源 hostname、来源 origin、目标页面和 Cookie 写入摘要。Cookie 部分失败时保留 `writable`、`failed`、`skipped` 数量并执行回读。

网络不稳定时，每轮最多尝试 2 次，轮内间隔 10 秒，轮间隔 25 秒；结果标记具体失败阶段。

## 同源规则

URL path 不参与同源判断；Cookie 使用 domain/path 规则，Web Storage 使用完整 origin（scheme + host + port）。登录页可以作为同源写入上下文，写入后应导航到任务 URL并完成回读。
