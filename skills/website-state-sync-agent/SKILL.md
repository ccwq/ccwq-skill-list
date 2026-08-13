---
name: website-state-sync-agent
description: 通过 Chrome DevTools Protocol 在浏览器页面之间迁移加密的网站 Cookie、localStorage 和 sessionStorage。用户明确提出网站状态导出、导入、同步或 CDP 回环验证时使用。
disable-model-invocation: true
---

# Website State Sync Agent

本 Skill 提供四种任务方法：`export`、`import`、`sync` 和 `validate`。执行器位于 `scripts/`，状态包服务位于 `lib/`。每次任务都从当前对话取得页面 URL；运行配置统一来自环境变量。

## 运行配置

| 环境变量 | 用途 | 默认值 |
|---|---|---|
| `WEBSET_STATE_SYNC_PASSWORD` | 状态包加密与解密密码 | `1599` |
| `WEBSET_STATE_SYNC_CDP_URLS` | 一个或多个 CDP HTTP 地址，逗号或换行分隔 | 无 |
| `WEBSET_STATE_SYNC_CDP_URL` | 单个 CDP HTTP 地址 | 无 |
| `WEBSET_STATE_SYNC_CHROME_PATH` | 隔离 Chrome 验证的可执行文件路径 | 无 |
| `WEBSET_STATE_SYNC_PROXY_URL` | 隔离 Chrome 验证的代理地址 | 无 |

密码来源在结果摘要中标记为 `environment` 或 `default`，摘要不包含密码或状态包内容。生产或共享环境应显式设置 `WEBSET_STATE_SYNC_PASSWORD`，替换默认值。

## 任务方法

### `export`

输入：当前已打开页面的 `url`，以及环境变量中的 CDP 地址和密码。

步骤：发现 CDP 页面 → 读取浏览器 Cookie 与当前 origin 的 Storage → 使用 AES-256-GCM 加密 → 写入 `.website-state-sync-agent/` 下的唯一文件。

完成标准：输出文件路径、加密状态和脱敏统计；文件存在且 `encrypted: true`。

执行器示例：

```powershell
node skills/website-state-sync-agent/scripts/state-sync.mjs export --url '<dynamic-page-url>'
```

### `import`

输入：加密状态包文件或文本，以及当前已打开目标页面的 `url`。

步骤：解析状态包 → 校验密码、来源域和目标 origin → 规划 Cookie → 写入 Cookie 与 Storage → 导航并回读验证。

完成标准：同时具备写入摘要、导航结果和 Cookie/Storage 回读证据，才可报告导入完成。

执行器示例：

```powershell
node skills/website-state-sync-agent/scripts/state-sync.mjs import '<encrypted-bundle-path>' --url '<target-page-url>'
```

### `sync`

输入：来源 CDP 地址、来源页面 URL、目标 CDP 地址、目标页面 URL。

步骤：执行 `export` → 对来源与目标执行同源校验 → 执行 `import` → 导航并回读验证。

完成标准：具备导出摘要、写入摘要、导航结果和 Cookie/Storage 回读证据。

执行器示例：

```powershell
node skills/website-state-sync-agent/scripts/state-sync.mjs sync `
  --source-cdp '<source-cdp-url>' `
  --source-url '<source-page-url>' `
  --target-cdp '<target-cdp-url>' `
  --target-url '<target-page-url>'
```

### `validate`

输入：隔离 Chrome 的 CDP 地址；可选环境变量 `WEBSET_STATE_SYNC_CHROME_PATH` 和 `WEBSET_STATE_SYNC_PROXY_URL`。

步骤：启动临时页面 → 写入、读取并清理测试 Cookie 和 Storage → 关闭临时资源。

完成标准：回环验证通过，且临时进程与目录已清理。

执行器示例：

```powershell
node skills/website-state-sync-agent/scripts/validate-cdp-cookie-roundtrip.mjs
```

## 阶段与错误分类

同步按 discovery、connection、export、write、navigation、readback 阶段推进。将 `fetch failed` 归入 discovery，将 WebSocket 错误归入 connection，将 `Runtime.evaluate` 超时归入 runtime，将 `Network.setCookies` 错误归入 write。网络不稳定时按每轮 2 次、轮内间隔 10 秒、轮间隔 25 秒重试，并报告失败阶段。

Cookie 按 domain/path 规划，Storage 按完整 origin（scheme + host + port）规划；目标页面可先使用同源登录页作为写入上下文，写入后导航到任务 URL并回读。

## 安全边界

- 状态包始终使用加密格式；导入任务接受 `encrypted: true` 的 JSON。
- 状态包文件保存在受信任目录，不进入 Git、公开上传或不受控传输渠道。
- 密码仅通过 `WEBSET_STATE_SYNC_PASSWORD` 或默认值 `1599` 参与运行；结果摘要只保留路径、状态和统计。
- 来源 Cookie 域与目标页面 origin 不匹配时，导入流程在写入前停止并要求明确的目标映射确认。
- 分区 Cookie 记录为 `skipped`，普通 Cookie 继续处理；最终摘要区分 `writable`、`skipped`、`failed` 和回读缺失数量。

协议细节与排障顺序见 [references/protocol.md](references/protocol.md)。
