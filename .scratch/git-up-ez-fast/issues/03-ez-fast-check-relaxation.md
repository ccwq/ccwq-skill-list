# ez-fast 放宽哪些检查条件

Status: resolved
Type: grilling
Parent: ../map.md
Blocked by: none

## Question

ez-fast 是「用户显式声明这个项目不重要」的信号。它能绕过哪些检查条件？快车道现有的回退条件分两类，哪些属于可放宽的？

## Answer

### 快车道回退条件分两类

| 类别 | 条件 | 性质 |
| --- | --- | --- |
| Git 级 | 已有暂存内容、存在冲突、Git 操作进行中、嵌套 Git 边界、目录联接、二进制与超大文件、风险路径 | 这次提交会不会损坏仓库 |
| 规划质量级 | 文件数超限、跨模块、无改动、任何语义拆分条件 | 这次提交好不好看 |

### 只放宽规划质量级

- 文件数上限：**ez-fast 下无上限**。
- 跨模块：不再因此回退。

Git 级条件**一条都不绕**。

理由：Git 级条件问的是「这次操作安不安全」，与用户在意不在意提交粒度无关。用户说「这个项目不重要」，说的是提交粒度 unimportant，不是「可以提交二进制大文件」。全放宽会让 ez-fast 变成绕过二进制与风险路径检查的后门。

### 文件数无上限的具体含义

快车道默认最多 5 个文件。ez-fast 下这个上限失效，文件数不再作为回退原因。

其余 Git 级条件仍然生效，所以「无上限」不等于「什么都提交」：暂存区非空、有冲突、Git 操作进行中、嵌套 Git 边界、二进制或超大文件、风险路径，任一条成立仍然回退。

### 与语义拆分条件的交互

快车道判定里的「任何语义拆分条件」（`changes` 存在、同一路径被多个步骤共享、存在依赖、存在补丁或中间状态文件、不支持的操作）在 ez-fast 下**不作为回退原因**。

理由：ez-fast 计划本身就不含 `changes`，不含补丁文件，不含中间状态文件。`depends_on` 保留（见 [工单 02](02-ez-fast-split-granularity.md)），但它不应触发快车道回退 —— ez-fast 下的依赖排序由文件级执行器处理。

这一条需要在实现时具体落到 `semantic_split_reasons` 的哪些项，见 [工单 08](08-script-surface-and-tests.md)。

### 对实现的影响

- `inspect_fast_path.mjs` 需要能识别「当前处于 ez-fast 上下文」，据此跳过文件数上限与跨模块两项判定，并放宽语义拆分条件导致的回退。
- ez-fast 上下文如何传递给检查器，是脚本改动面的内容，见 [工单 08](08-script-surface-and-tests.md)。

## Evidence

- 快车道现有回退条件清单：`skills/git-up/SKILL.md` 第 85 行「检查器默认最多允许 5 个文件，并回退以下情况：已有 staged 内容、冲突或进行中的 Git 操作、跨模块、Junction/嵌套 Git 边界、二进制/生成物/超大文件、无改动，以及任何语义拆分条件」。
- 检查器实现：`skills/git-up/scripts/inspect_fast_path.mjs` 第 164-171 行，`file_count_exceeded` 与 `multiple_modules` 是两条独立的 `reasons.push`。
- Git 级条件的具体清单：同文件第 165-192 行，`staged_changes_present`、`conflicts_present`、`git_operation_in_progress`、`risky_paths_present`。
- 本轮用户确认：只放宽规划质量级；文件数无上限；放宽文件数与跨模块。
