# ez-fast 的结果契约与抑制拆分提示

Status: resolved
Type: grilling
Parent: ../map.md
Blocked by: none

## Question

ez-fast 执行后，结果 JSON 怎么自证「本次禁用了语义拆分」？Agent 发现某个文件确实混了多个语义目的时，怎么把这个信息传出去？机器可读字段放在哪一层？

## Answer

### 结果顶层新增两个字段

```json
{
  "ok": true,
  "mode": "file",
  "semantic_split_disabled": true,
  "suppressed_split": ["package.json"],
  "completed_steps": [...],
  "verification": {...}
}
```

- `semantic_split_disabled`：布尔值，ez-fast 执行时为 `true`，其余场景不出现或为 `false`。它回答「本次是否禁用了语义拆分」。
- `suppressed_split`：字符串数组，列出被 ez-fast 抑制了语义拆分的路径。汇总所有步骤的声明。

理由：与现有 `ok`/`mode`/`verification` 同层，便于审计时一眼核对。`mode` 字段已经是 `file`，但它无法区分「普通文件级模式」与「ez-fast 强制文件级」—— 后者是被迫的，前者是自然的。这个区别需要单独字段。

### 计划新增步骤级可选字段 suppressed_split

```yaml
- step: 1
  subject: "build(deps): ✨安装依赖"
  files:
    - package.json
  suppressed_split:
    - package.json
```

放在**步骤级**，不改 YAML Lite 的顶层裸列表结构。解析器只需多认一个字段：`buildSteps()` 里与 `depends_on`/`files` 同级读取。

语义：该步骤包含的哪些路径「本可按语义目的拆分，但因 ez-fast 按文件整体提交」。

### 源头在规划阶段

语义归类只有规划阶段做得到，执行器事后无法推导。因此这个字段由 Agent 在生成计划时填写。

代价是判据问题 —— Agent 凭什么认定某个文件「可拆分」？这留下一张开放工单：[07 抑制拆分的判别](07-suppressed-split-detection.md)。未决前该字段允许为空，ez-fast 照常可用。

### 汇报文本另有一行

最终汇报里写一行说明被抑制的拆分，例如「`package.json` 含多个语义目的，因 `-z` 按文件整体提交」。

`-zp` 回显完整 YAML（用户要审阅计划），`-zc` 不回显 YAML、只给 JSON 摘要。两者都要包含这行文本提示。

### 对实现的影响

- `parsePlan` / `buildSteps()` 增加 `suppressed_split` 字段读取，类型为字符串数组。
- `executeFilePlan()` 结果顶层加 `semantic_split_disabled` 与汇总后的 `suppressed_split`。
- SKILL.md 的 ez-fast 章节要写明 Agent 在什么情况下填这个字段（判据待工单 07 定，先写「可留空」）。
- 语义模式与普通文件级模式的结果不含 `semantic_split_disabled`（或为 `false`），保持现有结果契约不变。

## Evidence

- 现有结果契约字段：`skills/git-up/references/semantic-commit.md` 第 153-165 行的「结果契约」表。
- 现有执行结果 JSON：`skills/git-up/scripts/commit_plan.mjs` 第 181-195 行，顶层已有 `ok`/`mode`/`base_head`/`final_head`/`target_tree`/`final_tree`/`completed_steps`/`skipped_steps`/`commits`/`verification`/`git_log`。
- YAML Lite 顶层结构：`skills/git-up/scripts/gitup_semantic.mjs` 第 322 行 `const rawSteps = []`，顶层是裸列表。
- 步骤字段解析：`skills/git-up/scripts/gitup_semantic.mjs` 第 370 行 `buildSteps()`，字段以 `item.<key>` 形式读取，新增字段沿用同一模式。
- 本轮用户确认：新增 `semantic_split_disabled` 字段；结果顶层两个字段；步骤级 `suppressed_split`；机器可读字段加文本一行。
