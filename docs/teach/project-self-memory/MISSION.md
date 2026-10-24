# Mission: project-self-memory 的完整用法

## Why

本仓库的维护者需要把 `project-self-memory` 用对，而不是只会跑命令。cache 暂存区落地后，「自动流程写候选、`-c` 逐条入库」成为新的主路径。用错一次的表现是：自动结论丢失、重复结论入库、失效候选覆盖用户手改的正文。掌握后，每次任务结束都能得到可信、可回溯的记忆库。

## Success looks like

- 能说清五种自动流程各自的行为，以及它们现在写到 `cache.jsonl` 而不是 `memory.md`。
- 能独立走完一次 `-c` 候选入库：读候选、看 diff、逐条决定、读回结果。
- 能判断一条候选是否失效，并解释失效为什么必须重新评估。
- 能按风险选择 `-g` / `-r` / `-t` 的组合，并知道谁不读 cache。
- 能用查看器与 CLI 各自该做的事，并且不违反单行契约。

## Constraints

- 时间有限。教程面向「已经会跑命令、但没吃透语义」的读者。
- 输出语言中文。术语沿用 `CONTEXT.md` 与本仓库 `references/`。
- 一切结论必须能在本仓库代码或文档里找到，不凭记忆推断。

## Out of scope

- 不讲 Node.js 基础，不讲 Git 基础。
- 不讲宿主接入的生产化细节；只讲参考 host adapter 的角色。
- 不修 `scripts/build-viewer.mjs` 的 CRLF shebang 缺陷（已记录的既有问题，与本特性无关）。
