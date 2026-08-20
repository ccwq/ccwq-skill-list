# debug_report 协议

所有 probe 的用户可回传内容必须是短文本、可读、可复制的三段协议。不要输出 JSON、原始命令海量日志或完整配置，除非当前问题明确需要机器解析且用户同意。

```text
SUMMARY
run_id: <随机标识>
probe_id: <category/name>
collection_status: ok | partial | fatal
redaction_status: ok | review | failed
clipboard_status: ok | unavailable | skipped_for_review
environment: os=<...>; shell=<...>; location=<...>; privilege=<...>
conclusion: <不超过两句的观察，不把猜测写成事实>
anomalies: <none 或有限异常摘要>

EVIDENCE
- <已脱敏、可核验的字段或有限命令结果>
- <每项注明 status=ok|failed|unavailable，必要时带退出码>

NEXT
suggested_next: <下一条最小只读动作；未知时写 agent_analysis_required>
```

## 约束

- `run_id` 必须在单次运行中唯一，且不使用主机名、用户名、路径或凭据生成。
- `collection_status=partial` 表示至少一个必需子步骤失败但仍有可用证据；`fatal` 表示无法形成可靠报告。
- `conclusion` 只能描述本轮直接观察，例如“TCP 连接被拒绝”；根因判断交由 Agent 在多轮证据后做出。
- `EVIDENCE` 默认不超过 12 项；每一项应能区分一个假设，超过上限时按相关性摘要。
- 任何凭据、用户身份、私有地址或路径必须在进入协议前按 `sanitization.md` 处理。
- `NEXT` 是建议而不是用户授权；不得在此嵌入修改命令。

## 终端状态行

报告产生后，终端用一行通知结果位置：

```text
RESULT_READY run_id=<id> clipboard=<ok|unavailable|skipped_for_review>
```

剪切板不可用时再输出完整报告；报告无法安全自动脱敏时，`clipboard=skipped_for_review` 并提示用户审阅后手动粘贴。
