# ez-fast 规则的脚本层强制点

Status: resolved
Type: grilling
Parent: ../map.md
Blocked by: none

## Question

「ez-fast 禁止语义拆分」这条规则靠什么保证？放在哪一层？用什么错误码？

## Answer

### 脚本层强制

`commit_plan.mjs` 新增独立 flag `--ez-fast`。传入后若计划含 `changes`（即 `planMode()` 返回 `semantic`），立即返回 `invalid_plan` 拒绝执行，不落任何提交。

理由：

1. 仓库已有同类先例。`commit_plan.mjs` 现有 `executePlan()` 已在 `--fast-path` 下拒绝语义计划，返回同一个 `invalid_plan`。脚本级互斥是既有模式，新增 ez-fast 不引入新机制。
2. 提示层约定在这个仓库不可靠。SKILL.md 里写过的约束（不 `git add .`、不 `git commit -a`、工作区不改动）都额外有脚本层或测试层的保证。
3. 事后检查（方案：SKILL.md + `inspect_fast_path.mjs` 复检报错）比脚本级前置拒绝多一次工具调用、少一道保证。

### 与 `--fast-path` 是两个独立 flag

`--ez-fast` 只管「禁用语义拆分」与「放宽检查」。`--fast-path` 只管「单提交 + 不回显 YAML」。两者正交，可以同时传（`-zpc` 场景），也可以只传其一。

`--ez-fast` **不隐含** `--fast-path`。用户已定 ez-fast 沿用文件级拆分规则（可能产出多个提交），若隐含单提交会与之矛盾。

### 错误码复用 invalid_plan

返回 `CODE_INVALID_PLAN`（值 `invalid_plan`），不新增错误码。

理由：语义计划 + ez-fast 就是「计划无效」。现有错误码表已有 8 项语义清晰，扩充需要同步多份文档与测试，收益不足。

拒绝信息要能让人看出原因，建议形如：`the --ez-fast flag forbids semantic plans; step N declares changes`。

### 拒绝发生在任何 Git 写操作之前

与现有语义模式的拒绝路径一致：不落补丁、不产生提交、暂存区保持为空。

### 对实现的影响

- `commit_plan.mjs` 的 `parseArgs()` 增加 `--ez-fast` 选项。
- `executePlan(steps, cwd, fastPathUsed)` 增加 ez-fast 参数，或在调用前先做一次判定。
- 拒绝要发生在 `ensureCleanIndex()` 之前还是之后需要定：优先在计划校验阶段（`validateSemanticPlan` 之前）拒绝，这样不触碰 index。
- `parse` 子命令也应收 `--ez-fast`，用于 `-zp` 场景下校验计划。

具体改动点与用例清单见 [工单 08](08-script-surface-and-tests.md)。

## Evidence

- 现有脚本级互斥先例：`skills/git-up/scripts/commit_plan.mjs` 第 200-207 行，`executePlan()` 在 `fastPathUsed` 且 `planMode(steps) === 'semantic'` 时返回 `CODE_INVALID_PLAN`，信息为 `the fast path cannot execute a semantic plan; run the full planning flow instead`。
- 错误码定义：`skills/git-up/scripts/gitup_semantic.mjs` 第 29-37 行，8 个错误码常量。
- 语义计划校验入口：`skills/git-up/scripts/gitup_semantic.mjs` 第 764 行 `validateSemanticPlan()`，第 776-779 行已拒绝「语义模式下声明 `files`」的步骤，是同类「模式冲突即拒绝」的先例。
- 本轮用户确认：脚本强制拒绝；复用 `invalid_plan`；两个独立 flag。
