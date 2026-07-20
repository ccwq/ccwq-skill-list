---
name: gemin-mirror
description: Gemini/兼容镜像站的多账号会话探针与安全删除。
disable-model-invocation: true
---

# Gemini mirror session management

本 skill 的核心是**证据链**：每次操作都把目标页面、唯一活动账号、会话计数和刷新后的结果连成可复核的记录。它只处理用户明确授权的数据，并复用已有 CDP 标签页。

默认适配器及其可覆盖字段见 [`references/site-map.md`](references/site-map.md)。适配器缺少所需证据时，本次操作止于只读探针。

## 1. 选择分支

- **探针**：只读取页面、登录状态、账号证据和会话计数。
- **当前账号删除**：以唯一活动账号为目标；优先 API runner，DOM runner 是用户明确选择的回退。
- **多账号删除**：先从默认适配器发现候选，再逐个切换、核验和删除。

完成条件：已声明操作分支、目标范围和是否允许删除；多账号分支已确认使用默认适配器。

## 2. 建立证据链

删除前，证据链必须同时包含：

1. 页面 URL 位于允许的 origin，且登录状态有效；
2. `--expected-account` 与唯一活动账号证据完全匹配；
3. 删除前的原生会话计数；
4. 多账号分支额外具备：目标 dashboard 卡片唯一选中、唯一活动邮箱，以及原生列表重新加载。

完成条件：每个目标账号均具备完整证据链；任一账号证据不唯一时，停止该批操作并报告。

## 3. 删除与复核

API runner 先捕获当前页面的同源请求模板和运行时参数，再删除会话；仅对限流与服务端失败进行有限重试。模板、账号证据或响应语义不完整时，保留现场并报告。

DOM runner 使用实时元素位置完成单条删除，只在用户明确要求其作为回退时使用。

完成条件：每个成功目标在稳定等待并强制刷新后，会话计数仍为 0；未达标目标与原因写入审计。

## 4. 审计

审计记录时间、runner、账号短哈希、动作、before/after、重试次数、错误和 URL。运行时认证参数、完整账号 ID、会话 ID、Cookie 与会话正文不进入审计。

完成条件：每个目标都有 after 状态；审计可区分已完成与未完成目标。

## 入口

- `scripts/delete-sessions-via-api.mjs`：当前已核验账号的 API-first 删除。
- `scripts/delete-current-account-sessions.mjs`：当前已核验账号的 DOM 回退。
- `scripts/delete-candidate-accounts.mjs`：默认适配器的多账号遍历，必须带 `--confirm-delete-all`。
- `scripts/session-safety.mjs`：账号规范化、唯一性核验与审计脱敏。
