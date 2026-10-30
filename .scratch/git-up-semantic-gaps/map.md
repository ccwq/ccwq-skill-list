# git-up 语义执行的能力缺口取舍

Label: wayfinder:map

## Destination

判定 git-up 语义执行的四个能力缺口（二进制、重命名、复制、模式变更）是否值得补齐，给出每项做或不做及代价。本轮只出决策，不写实现规格。

## Notes

- 使用本地 Markdown tracker；后续按 `docs/agents/issue-tracker.md` 查询、认领和推进。
- 讨论使用 grilling、domain-modeling。领域术语见根 CONTEXT.md；该文件属于 project-self-memory 域，本轮不新增术语。
- 用户已定：范围只限 git-up 的四个能力缺口；终点是取舍决定不写实现规格；缺口来源是规格列举而非实际撞到；自动 JSON/YAML 语义分解归 Agent 层。
- 判定以实测行为为准，不以规格列举为准。实测在临时仓库进行，未改动实现代码。
- 实现已提交在分支 `feat/git-up-semantic-split`。本轮不修改该实现。
- 其余四个遗留项不在本图范围：全仓库 Python→Node.js 迁移、`skills-lock.json` 哈希、推送远端、以及 `gitignore_manager` 等其它脚本。

## Decisions so far

- [四个能力缺口的取舍判定](issues/01-capability-gap-tradeoff.md)：二进制、复制、重命名三项能力已由 `content` 模式与删除加新增覆盖，不补实现；模式变更不补能力，但要提前报错时机。
- [模式变更的报错时机](issues/02-mode-change-error-timing.md)：改为提交前拒绝。扫描补丁时识别 `old mode`/`new mode`，返回 `unsupported_operation`，不落地提交。

## Not yet specified

- 目标快照从工作区推导这一假设的边界：任何只存在于 index 的变更（mode、intent-to-add、skip-worktree）都无法表达。mode 已改为提交前拒绝，快照层是否另立表示方式留待后续实际需要时再定。
- 显式失败与实际能力之间的落差如何对外说明。规格写的是"除非显式支持否则停止"，实际有三条路径能力已具备，只是写法不同。是否需要在文档里补一张"能力对照表"，尚未决定。

## Out of scope

- 自动 JSON/YAML 语义分解。归 Agent 层，由 Agent 写中间状态。
- 其余 7 个 skill 的 Python→Node.js 迁移，约 5200 行。
- `skills-lock.json` 的 git-up 哈希。该文件上次同步是 2026-08-11，git-up 此后已改动三次，属既有状态，仓库无工具校验。
- 推送分支到 `origin`。
- 补齐模式变更的提交能力。mode 只存在于 index，`content` 模式不提供 mode 参数，人工处理即可。
