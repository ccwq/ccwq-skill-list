# ez-fast 的脚本改动面与测试口径

Status: open
Type: task
Parent: ../map.md
Blocked by: 04-ez-fast-script-enforcement.md

## Question

`commit_plan.mjs` 与 `inspect_fast_path.mjs` 为支持 ez-fast 各要改哪些点？回归用例清单是什么？落在哪个测试套件？

## 需要产出的清单

### commit_plan.mjs

- `parseArgs()` 增加 `--ez-fast`。
- `parse` 子命令与 `commit` 子命令都接受 `--ez-fast`。
- 拒绝点：ez-fast + 语义计划 → `invalid_plan`，发生在任何 Git 写操作之前（含 `ensureCleanIndex()` 之前，避免触碰 index）。
- `executeFilePlan()` 结果顶层新增 `semantic_split_disabled` 与汇总后的 `suppressed_split`。
- 语义模式与普通文件级模式的结果保持现有契约不变。

### gitup_semantic.mjs

- `buildSteps()` 读取步骤级 `suppressed_split`（字符串数组）。
- 校验：`suppressed_split` 里的路径必须出现在该步骤的 `files` 中，否则 `invalid_plan`（待定，见工单 07 的判据讨论）。
- `stepToDict()` 是否回显该字段。

### inspect_fast_path.mjs

- 识别 ez-fast 上下文的方式：新增 `--ez-fast` flag，或接受 `--plan-file` 时从计划内容判断。待定。
- ez-fast 上下文下跳过 `file_count_exceeded` 与 `multiple_modules`。
- ez-fast 上下文下不放宽 Git 级原因：`staged_changes_present`、`conflicts_present`、`git_operation_in_progress`、`risky_paths_present`。
- `semantic_split_reasons` 的哪些项在 ez-fast 下不再作为回退原因（见工单 03 的「与语义拆分条件的交互」）。

### 回归用例清单

| 用例 | 断言 |
| --- | --- |
| ez-fast 单独使用等价 `-p` | 只输出 YAML 计划，不提交，回显完整 YAML |
| ez-fast 拒绝语义计划 | 返回 `invalid_plan`，HEAD 不变，暂存区为空 |
| ez-fast 拒绝发生在写操作前 | index 不被触碰 |
| ez-fast 允许文件级计划 | 正常按文件级规则提交 |
| ez-fast 保留 depends_on | 依赖顺序生效，成环返回 `dependency_cycle` |
| ez-fast 结果字段 | `semantic_split_disabled` 为 `true`，`suppressed_split` 汇总正确 |
| ez-fast + 快车道 | 命中则单提交，未命中则文件级拆分 |
| ez-fast 放宽文件数与跨模块 | 检查器不再因此回退 |
| ez-fast 不放宽 Git 级条件 | 已有暂存内容、冲突、风险路径仍回退 |
| 参数组合矩阵 | `-zp`/`-pz`/`-zc`/`-zpc`/`-zs` 行为符合工单 01 |
| 现有用例不回归 | 现有 22 + 47 例全部仍通过 |

### 测试套件归属

待定：落在 `test-space/git-up-commit-plan-tests/run_tests.mjs`（现有文件级套件）还是新建 `test-space/git-up-ez-fast-tests/`。判据是新增用例数量与是否需要独立 fixture。

## 备注

本工单是 task —— 不需要用户做决定，但需要动手把改动面列全。完成后应产出一份可执行的实施清单，供实现轮直接照做。

前置：工单 04 已定 flag 形态与错误码。
