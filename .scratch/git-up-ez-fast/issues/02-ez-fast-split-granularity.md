# ez-fast 的拆分粒度与提交数量

Status: resolved
Type: grilling
Parent: ../map.md
Blocked by: none

## Question

ez-fast 模式下计划怎么拆？产出几个提交？与现有文件级模式、语义模式的关系是什么？

## Answer

### 只按文件区分

ez-fast 的计划是文件级计划：步骤用 `files` 声明路径。不声明 `changes`，不做语义归类，不生成补丁，不建中间状态文件。

### 沿用文件级拆分规则

提交数量沿用文件级模式现有规则 —— 按类型、模块和依赖顺序拆分，一个提交可以包含多个文件。ez-fast 不强制单提交。

理由：单提交与「按快车道判定」这两种行为已经各自有对应机制 —— 单提交是快车道（`-pc` 满足条件时），快车道回退是文件级规则。ez-fast 若也做这两件事，就成了快车道的别名。ez-fast 真正独有的价值是**免除语义判断**：不读 diff 做语义归类、不生成补丁、不做语义拆分检查。

### depends_on 保留

`depends_on` 是文件级与语义模式共用的字段。ez-fast 只禁语义拆分，不禁依赖排序。依赖成环时仍返回 `dependency_cycle`。

### `-z` 与 `-pc` 组合

两个机制同时生效：

- 快车道命中 → 单提交。
- 快车道未命中 → 回退到文件级拆分，可能产出多个提交。

这与 [工单 06](06-ez-fast-fast-path-interaction.md) 的结论一致：ez-fast 改拆分粒度，快车道改汇报形态。

### 规划阶段仍然读 diff

Agent 照常读单个文件的 diff —— 写 commit message 本来就需要。省掉的是「这个文件有几个语义目的」的拆解动作，以及随之而来的补丁生成、`split_patch.mjs` 调用和中间状态文件。

不采用「完全不读单个 diff」的方案：那会让 commit message 质量下降，而读 diff 不是 ez-fast 的主要成本来源。

### 对实现的影响

- ez-fast 计划用现有 YAML Lite 的 `files` 字段，不新增结构。
- `planMode()` 对 ez-fast 计划返回 `file`，执行器走现有文件级路径，无需新增执行分支。
- SKILL.md 的 ez-fast 章节要写明「沿用文件级拆分规则」，避免 Agent 误以为 ez-fast 等于单提交。

## Evidence

- 文件级模式现有规则：`skills/git-up/SKILL.md` 第 30 行「每个提交使用明确 `files` 路径，按类型、模块和依赖顺序拆分」。
- `depends_on` 是共享字段：`skills/git-up/SKILL.md` 第 32 行「两种模式都支持 `depends_on` 声明前置步骤。执行器按依赖拓扑排序，成环时停止」。
- `planMode()` 的二分：`skills/git-up/scripts/gitup_semantic.mjs` 第 472 行，无 `changes` 即为 `file`。
- 本轮用户确认：沿用文件级拆分规则；保留 `depends_on`；照常读 diff 但不拆分。
