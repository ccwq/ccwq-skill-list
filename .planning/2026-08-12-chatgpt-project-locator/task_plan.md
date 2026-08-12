# ChatGPT Project Locator

## Goal

设计、现场验证并固化一个脚本：在已登录的 ChatGPT tab 内通过可见 sidebar DOM 定位指定 Project，跳转其真实 `/project` 主页并返回经校验的 URL；不调用或重放后台接口。

## Phases

1. **设计** — 明确输入、DOM 查询、跳转、输出、失败和证据契约。 `completed`
2. **现场验证** — 在现有 CDP tab 验证 DOM 选择、点击跳转和主页 URL/页面证据。 `completed`
3. **固化** — 新增脚本、离线单测和 skill 文档同步。 `completed`
4. **回归验收** — 运行离线测试、静态检查和可用时的浏览器 smoke。 `completed`
5. **扩展边界回归** — 覆盖已在主页、不存在项目、失效 tab 和不同已存在项目。 `completed`

## Guardrails

- 只使用现有登录态与 CDP tab；每个 browser 操作固定 `--cdp 9696`。
- 不直接请求、重放或保存 `/backend-api/*` 数据。
- Project 主页 URL 必须来自浏览器导航后的实时 `get url`，不得拼接或预存。
- 仅在目标 Project 的名称匹配和主页 UI 证据成立时成功。

## Errors

| Error | Attempt | Resolution |
| --- | --- | --- |
| `net::ERR_CONNECTION_CLOSED` on ChatGPT reload | 1 | 保留为现场网络阻断；不重放后台 URL，等待恢复后再执行真实 UI 验证。 |
| `.group/project-unfurl-row` selector caused DOM `SyntaxError` | 1 | CSS class token contains `/`; switch to `[class~="group/project-unfurl-row"]` in the next, distinct validation attempt. |
| Homepage navigation regressed to `chrome-error://chromewebdata/` | 2 | Do not retry the same navigation. Reuse a healthy existing ChatGPT tab once available, then run the selector-corrected action. |
| Offline test import could not resolve sibling `run_agent_browser` module | 1 | Add the script directory to `sys.path` in the isolated test harness; production CLI already resolves sibling imports. |
| Live smoke parsed agent-browser's wrapper instead of locator payload | 1 | Recursively unwrap JSON objects and stringified JSON until the locator keys (`matchCount` or `clicked`) are found; add a nested-wrapper regression test. |
