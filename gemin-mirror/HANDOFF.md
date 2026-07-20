# Gemini Mirror Skill Handoff

## 目标

将 Gemini 镜像站的全面操作经验固化为 user-invoked skill；当前正式交付位于 [`../skills/gemin-mirror/`](../skills/gemin-mirror/)。

## 已完成

- Skill 主流程、站点调查参考和 Node.js 会话删除脚本均已写入 `skills/gemin-mirror/`。
- 脚本采用能力探针、实时坐标、有限重试、fail-closed 和 JSONL 审计。
- 命令执行器规范：Windows 先 `w -l`，若含 `abc` 则使用 `w abc`；Linux/macOS 在存在时加载 `~/.bashrc` 后使用 `abc`；不可用或执行失败再回退 `agent-browser`。
- runner 会写入审计；复杂 JavaScript 表达式经 Windows `wsha` 解析失败时已经验证可回退到原生 CLI。
- Node.js 静态检查和只读 smoke test 已通过。

## 关键决策

- 仅明确调用 `$gemin-mirror` 时触发。
- 优先复用现有 Gemini 标签页；找不到目标标签页就暂停。
- 支持手动和自动账号切换；自动模式必须先展示账号清单并由用户确认筛选和顺序。
- 面板存在时使用 `#_my_chat_list_container` 的账号卡片数据，不能以原生列表为 0 误判账号为空。
- 破坏性操作按类别授权；账号删除、退出登录和充值始终单独确认。
- 仅对已建立参数契约的 API 使用加速；未知 RPC 继续走 UI/CDP。

## 已知边界

- 不在 handoff 中记录账号、cookie、token 或完整会话内容。
- 当前没有待恢复的破坏性操作；下次执行前需重新做探针并取得用户本次授权。
- API RPC 标识和页面 DOM 有漂移风险，操作前应阅读 [`../skills/gemin-mirror/references/site-map.md`](../skills/gemin-mirror/references/site-map.md)。

## 建议下一步

1. 用 `$gemin-mirror` 在目标浏览器会话执行只读探针，确认当前 DOM 和 runner。
2. 若要扩展自动切号或 API 操作，先调查并为每个动作补充可验证契约。
3. 为脚本补充不依赖真实账号的 mock/eval 测试。

## Suggested skills

- `gemin-mirror`：执行该站点的浏览器操作。
- `agent-browser`：浏览器探查、快照与 CDP 验证。
- `grill-me`：执行高风险或多账号批处理前澄清授权范围。
- `handoff`：跨 session 继续维护本 skill 时生成更新交接。
