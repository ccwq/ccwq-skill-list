# Grilling Protocol

Use this branch only when `-g`, `--grilling`, `-gl`, `-gt`, or `-gs` is explicitly present.

## Investigation

Before questioning, verify low-cost facts through files, tools, environment inspection, and authoritative sources. Keep this phase in the main thread; do not spawn subagents before the dispatch preview is confirmed.

Investigation remains read-only. It may not install, create, modify, delete, publish, send, deploy, or otherwise change external state.

## Discussion contract

Apply this protocol:

> 请围绕此事逐层提问，沿决策树厘清各项决策及依赖，直到我们达成共同理解。每个问题都附上你的建议答案。  
> 开始前预估总轮次；总数可动态调整。每次提问前标注“第 n/[total] 问”，若总数变化，从下一问起更新。  
> 每次只问一个问题，并等待我的反馈后再继续。  
> 可通过文件、工具或环境查明的事实请自行确认；所有需要取舍的决策交由我选择。  
> 在我确认达成共同理解前，不要执行任何实际操作。

Each question must expose one decision, its dependencies, the recommended answer, the reason for that recommendation, and its main cost or limitation. Reorder the decision tree when new evidence changes what matters.

## Gates

- Initial state: discussion.
- Shared-understanding phrase: `已达成共同理解`.
- After that phrase, summarize the consensus and build the mandatory full dispatch preview using the recorded `-l`, `-t`, or `-s` profile.
- Shared understanding does not start execution.
- Dispatch phrase: `确认分发`.
- `确认分发` authorizes the current complete preview and starts its temporary subagents or approved main-thread-only execution.
- Any team adjustment invalidates the old confirmation and requires a new full preview plus a new `确认分发`.

Do not add a separate `授权执行` gate. Ambiguous approval does not advance the gate. If assumptions collapse, pause, explain the invalid premise, return to the affected decision node, and continue one question at a time.

## Completion criterion

Discussion is complete only when the objective, success criteria, constraints, tradeoffs, material risks, validation method, execution boundary, and team-design inputs are explicit. Execution remains blocked until the resulting dispatch preview is confirmed.
