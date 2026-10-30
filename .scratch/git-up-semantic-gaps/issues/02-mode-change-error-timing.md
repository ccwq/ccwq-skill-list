# 模式变更的报错时机

Status: open
Type: grilling
Parent: ../map.md
Blocked by: 01-capability-gap-tradeoff.md

## Question

模式变更的补丁能被 `git apply --cached` 应用，提交也能落地，但目标快照从工作区推导，无法表达纯索引的 mode 变更，于是最终校验在提交之后报 `target_verification_failure`。

要不要把"提交后失败"提前成"提交前明确拒绝"？如果要，拒绝点放在哪一层，拒绝信息写什么？

## 候选

1. **扫描补丁时拒绝**。`scanPatch` 见到 `old mode` 或 `new mode` 就返回 `unsupported_operation`，与二进制、重命名、复制同一套处置。改动约五行，落在 `gitup_semantic.mjs` 的补丁扫描层。
2. **快照层表达索引专属变更**。目标快照不只从工作区推导，也纳入 index 里的 mode。改动更大，且要回答 index 与工作区不一致时以谁为准。
3. **不改**。接受"提交成功但报告失败"，在文档里说明这条路径。

## 需要定的点

- 选 1 还是选 3。选 2 的代价与收益见上面的候选说明。
- 若选 1，`unsupported_operation` 的信息怎么写。模式变更是四种不支持操作里唯一"补丁本来能应用"的，不写清楚容易被当成执行器坏了。
- 拒绝之后 index 里会不会留下内容。补丁在扫描阶段就被拦下，尚未应用到 index，预期不留。要在决定时确认这一点。
- 是否顺带在文档里补一张能力对照表，说明二进制、重命名、复制各有已覆盖的写法。见 map 的"尚未明确"。

## Evidence

- 实测：`git apply --cached` 对 `old mode 100644` / `new mode 100755` 的补丁返回 0，commit tree 为 `100755`；执行器随后返回 `target_verification_failure`，`target_tree` 为 `100644`。
- 实测：`content` 模式新建文件恒为 `100644`。
