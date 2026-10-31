# ez-fast 的脚本改动面与测试口径

Status: resolved
Type: task
Parent: ../map.md
Blocked by: 04-ez-fast-script-enforcement.md

## Question

`commit_plan.mjs` 与 `inspect_fast_path.mjs` 为支持 ez-fast 各要改哪些点？回归用例清单是什么？落在哪个测试套件？

## 决议（实施清单，实现轮照此执行）

前置核对说明：工单 04/05 引用的行号与当前源码基本一致（`executePlan` 现位于 `commit_plan.mjs:199`，fast-path 拒绝语义计划在 200-207 行；`buildSteps` 在 `gitup_semantic.mjs:443`）。以下清单按当前源码编写。

### 1. gitup_semantic.mjs（解析与校验层）

| 改动点 | 内容 |
| --- | --- |
| `readValue()`（约 342 行） | 新增 `suppressed_split` 分支：空值 → `readScalarList` 读字符串列表；内联标量拒绝（与 `changes` 同类错误）。块标量首行拒绝清单（348 行）加入 `suppressed_split` |
| `buildSteps()`（约 443 行） | 读取 `item.suppressed_split`：必须是字符串数组；逐项 trim 后不得为空；去重；默认 `[]`。经 `createStep` 新参数 `suppressedSplit` 传入 |
| `createStep()`（90 行） | 增加 `suppressedSplit = []` 形参并挂到步骤对象 |
| `stepToDict()`（118 行） | 输出 `suppressed_split: step.suppressedSplit`，`-zp` 回显时可见 |
| `validatePlanStructure()`（518 行） | 新增校验：① 语义模式步骤声明 `suppressed_split` → `invalid_plan`（该字段只对 files 有意义）；② 文件级模式下每项必须 ∈ 该步骤 `files` → 否则 `invalid_plan`，消息形如 `step N suppressed_split path "x" is not declared in files` |

校验放解析层而非执行层：路径归属错误是「计划无效」，与缩进错误同级，任何子命令（`parse`/`commit`）都应拒绝。

### 2. commit_plan.mjs（执行器）

| 改动点 | 内容 |
| --- | --- |
| `parseArgs()`（217 行） | 新增 `ezFast: false`，识别 `--ez-fast` |
| `parse` 子命令（301 行） | `--ez-fast` 且 `planMode === 'semantic'` → 返回 `invalid_plan`（消息与 commit 一致），exit 2；文件级计划正常输出，`stepToDict` 已含 `suppressed_split`。`-zp` 场景靠它校验 |
| `executePlan()`（199 行） | 签名加 `ezFast = false`。语义计划 + `ezFast` → 返回 `invalid_plan`，消息 `the --ez-fast flag forbids semantic plans; step N declares changes`。**拒绝位置在 `executeFilePlan` 之前，即 `ensureCleanIndex()` 之前**——已预暂存内容的仓库收到语义 ez-fast 计划时，应报 `invalid_plan` 而非 `staged_changes_present`，index 不被触碰 |
| `executeFilePlan()`（68 行） | 签名加 `ezFast = false`。结果顶层：`ezFast === true` 时输出 `semantic_split_disabled: true` 与 `suppressed_split: [...各步骤声明去重排序]`；非 ez-fast 时**两个字段都不出现**，保持现有结果契约字节级不变（既有用例无感） |
| `USAGE`（247 行） | 补 `--ez-fast` 行说明 |

`--ez-fast` 不隐含 `--fast-path`（工单 04 已定）。`-zpc` 场景两个 flag 同时传。

### 3. inspect_fast_path.mjs（快车道检查器）

| 改动点 | 内容 |
| --- | --- |
| 上下文识别方式（原待定项） | **定为新增 `--ez-fast` flag**。否决「从计划内容判断」：首次检查发生在计划产出之前，无计划文件可读；调用方（`-z` 场景的 Agent）本来就知道自己在 ez-fast 上下文 |
| `parseArgs()` | 新增 `ezFast` |
| `inspect()` | 签名加 `ezFast = false`。`ezFast` 为 true 时：`file_count_exceeded` 与 `multiple_modules` 不再 push；`planReasons`（语义拆分条件）不并入 `fallback_reasons`。Git 级条件（`staged_changes_present`、`conflicts_present`、`git_operation_in_progress`、`risky_paths_present`、`no_changes`）一条不绕 |
| 结果契约 | `ezFast` 时顶层加 `ez_fast: true`（可观测），`semantic_split_reasons` 照常报告但不影响 `eligible` |
| `USAGE`（250 行） | 补 `--ez-fast` 说明 |

### 4. 回归用例清单（每个用例附中文 GWT 注释）

全部落在 `test-space/git-up-commit-plan-tests/run_tests.mjs`。理由：该套件已覆盖快车道检查器（`runFastPath`）与文件级执行器（`runPlan`），全部现有 helper 直接复用，无需独立 fixture；语义套件（`git-up-semantic-tests`）不需要新用例，跑通即算不回归。

`runFastPath(cwd)` helper 需加可选 args 参数（对齐 `runPlan` 的第四参）。

| # | 用例 | 断言 |
| --- | --- | --- |
| 1 | `testEzFastParseAcceptsFilePlan` | `parse --ez-fast` 文件级计划 → `ok=true`、`plan_mode=file`、steps 含 `suppressed_split` 字段 |
| 2 | `testEzFastParseRejectsSemanticPlan` | `parse --ez-fast` 语义计划 → exit 2、`invalid_plan` |
| 3 | `testEzFastRejectsSemanticPlanBeforeIndexTouch` | 预暂存 1 文件 + 语义计划 + `commit --ez-fast` → 返回 `invalid_plan`（**不是** `staged_changes_present`），HEAD 不变，预暂存内容原样保留 |
| 4 | `testEzFastCommitAcceptsFilePlan` | `commit --ez-fast` 文件级计划 → 正常提交，计划外文件保持未跟踪 |
| 5 | `testEzFastKeepsDependencyOrder` | 复用 `testFilePlanFollowsDependencyOrder` 场景 + `--ez-fast` → 依赖顺序生效 |
| 6 | `testEzFastRejectsDependencyCycle` | 环依赖 + `--ez-fast` → `dependency_cycle`，无提交 |
| 7 | `testEzFastResultFields` | 计划含 `suppressed_split`（跨两步骤）→ 结果 `semantic_split_disabled=true`、`suppressed_split` 为去重排序并集；无声明的计划 → `semantic_split_disabled=true`、空数组 |
| 8 | `testNonEzFastResultKeepsContract` | 同一计划不带 `--ez-fast` → 结果**不含** `semantic_split_disabled`/`suppressed_split` 键（防契约泄漏） |
| 9 | `testEzFastWithFastPathCombo` | `commit --ez-fast --fast-path` → `fast_path_used=true` 且 `semantic_split_disabled=true`（`-zpc` 正交组合） |
| 10 | `testSuppressedSplitPathNotInFilesRejected` | `suppressed_split` 路径 ∉ `files` → `invalid_plan`，消息含路径 |
| 11 | `testSuppressedSplitInSemanticModeRejected` | 语义计划声明 `suppressed_split` → `invalid_plan` |
| 12 | `testSuppressedSplitBlockScalarRejected` | `suppressed_split: \|` → `invalid_plan`（列表字段禁块标量） |
| 13 | `testInspectEzFastRelaxesQualityChecks` | 检查器 `--ez-fast`：6 文件跨两模块 → `eligible=true`、`ez_fast=true`；`semantic_split_reasons` 照常报告 |
| 14 | `testInspectEzFastKeepsGitLevelChecks` | 检查器 `--ez-fast` + 预暂存内容 → 仍报 `staged_changes_present`、`eligible=false` |
| 15 | 现有用例不回归 | commit-plan 套件现有用例全通过；semantic 套件 49 例全通过 |

### 5. 不做

- 不给 `gitignore_manager.mjs` 加 ez-fast（`-zi` 已被工单 01 拒绝，无交互面）。
- 不在检查器里校验 ez-fast 计划的 `suppressed_split`（校验在解析层，检查器读 `parsePlan` 抛错即回退，`plan_error` 机制已覆盖）。
- 不新增错误码（工单 04 已定复用 `invalid_plan`）。
- 不改打包与文档（工单 09 的范围）。

## 备注

前置工单 04、05、07 均已 resolved，本清单是三者的机械展开，无遗留决策点。实现轮完成后按「新增 / 修改 skill 同步清单」进工单 09。
