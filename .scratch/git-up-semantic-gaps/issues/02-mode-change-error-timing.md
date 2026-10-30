# 模式变更的报错时机

Status: resolved
Type: grilling
Parent: ../map.md
Blocked by: 01-capability-gap-tradeoff.md

## Question

模式变更的补丁能被 `git apply --cached` 应用，提交也能落地，但目标快照从工作区推导，无法表达纯索引的 mode 变更，于是最终校验在提交之后报 `target_verification_failure`。

要不要把"提交后失败"提前成"提交前明确拒绝"？如果要，拒绝点放在哪一层，拒绝信息写什么？

## Answer

改成提交前明确拒绝。拒绝点放在补丁扫描层，与二进制、重命名、复制同一套处置。

### 决定

- `scanPatch` 识别 `old mode` 与 `new mode` 行，归入不支持的操作。补丁不会被应用，不会产生提交，暂存区保持为空。
- 拒绝信息沿用 `unsupported_operation`，信息里带 `mode`。
- 不改目标快照层。快照从工作区推导是它的定义，不为单一操作开特例。

### 理由

规格用户故事 17 要求不支持的操作"安全停止"。模式变更此前不是安全停止：补丁先落地、提交进历史，然后才报失败，且信息把原因指向"树不匹配"，掩盖真实成因。提交后失败是四种不支持操作里最糟的表现形态。

改动落在 `gitup_semantic.mjs` 的补丁扫描层，约五行，与既有二进制、重命名、复制的拒绝路径同构。

### 仍然不做

不补模式变更的提交能力。mode 只存在于 index，`content` 模式也不提供 mode 参数。要提交可执行位变更，仍需人工处理。

### 验证

- 用例 `test-space/git-up-semantic-tests/run_tests.mjs` 的 `testModeChangeIsRejectedBeforeCommitting`。
- 去掉扫描层识别后，该用例报 `target_verification_failure`；加上后报 `unsupported_operation`，且 `HEAD` 不变、暂存区为空。
- 文档同步：`references/semantic-commit.md` 的"不支持的操作"小节写明拒绝发生在提交之前；`CHANGELOG.md` 记录该修复。

## Evidence

- 实测：模式补丁应用返回 0，commit tree 为 `100755`，执行器返回 `target_verification_failure`，`target_tree` 为 `100644`。
- 实测：修复后同一场景返回 `unsupported_operation`，`git rev-parse HEAD` 不变，`git diff --cached --name-only` 为空。
