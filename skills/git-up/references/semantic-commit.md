# 语义拆分提交

语义模式把一次提交拆成多个语义组。每组用自己的补丁暂存，因此同一个文件可以进入多个提交。

## 何时使用

满足任一条件时使用语义模式：

- 同一文件包含多个语义目的的改动，例如 `package.json` 同时有依赖安装、格式调整和 `scripts` 增加。
- 提交之间存在依赖顺序，例如脚本提交必须排在依赖安装之后。
- 需要严格证明拆分后没有丢失改动，也没有把无关改动带进提交。

其它情况使用文件级计划。文件级计划声明 `files`，执行器只 `git add -- <files...>`。

## 计划格式

计划 YAML 仍是 YAML Lite。语义步骤用 `changes` 声明补丁，用 `depends_on` 声明顺序。

```yaml
- step: 1
  subject: "build(deps): ✨安装依赖"
  reason: "依赖必须先于脚本提交"
  changes:
    - path: package.json
      patch_mode: content
      patch_file: .scratch/git-up/state-1.json
    - path: package-lock.json
      patch_mode: patch
      patch_file: .scratch/git-up/step-1-lock.patch
- step: 2
  subject: "style(format): ✨统一格式"
  depends_on:
    - 1
  changes:
    - path: package.json
      patch_mode: content
      patch_file: .scratch/git-up/state-2.json
```

字段含义：

| 字段 | 说明 |
|---|---|
| `step` | 步骤号。`depends_on` 引用这个号。 |
| `subject` | 提交标题。 |
| `reason` | 该语义组存在的理由。只用于审阅，不进入提交信息。 |
| `depends_on` | 前置步骤号列表。执行器按此做拓扑排序。必须写成列表，例如 `depends_on: [1]`。 |
| `changes` | 该步骤的补丁清单。语义模式下每个步骤都必须声明它。 |
| `changes[].path` | 该补丁允许触碰的仓库相对路径。 |
| `changes[].patch_mode` | `patch`、`3way` 或 `content`。 |
| `changes[].patch_file` | 补丁文件或中间状态文件。路径相对仓库根目录，也可以是绝对路径。 |
| `changes[].whitespace` | 空白策略。默认 `nowarn`。可选 `warn`、`error`、`fix`。 |

一个路径可以出现在多个步骤。语义模式下每个步骤都必须声明 `changes`。语义步骤不得声明 `files`：含 `files` 的步骤会被拒绝，语义模式不会回退到文件级暂存。

## 补丁模式

### `patch` 与 `3way`

补丁是 unified diff。执行器用 `git apply --cached` 写入 index，不改动工作区。

补丁必须由 `git diff` 生成。`git diff` 输出的是 index 表示的内容，在 `core.autocrlf=true` 的 Windows 仓库里是 LF。直接用文件工具比较工作区文件得到的补丁含有 CRLF，无法应用到 index。

拆分同一文件的多个 hunk：

```bash
git diff -U1 -- src/app.ts > .scratch/git-up/full.patch
node skills/git-up/scripts/split_patch.mjs --diff .scratch/git-up/full.patch --out .scratch/git-up/patches
```

`split_patch.mjs` 按 hunk 边界拆分补丁，输出 JSON 清单。清单给出每个源文件对应的补丁文件路径：

```json
{
  "ok": true,
  "files": [
    {
      "path": "src/app.ts",
      "binary": false,
      "hunks": [
        { "index": 1, "patch": ".../patches/full-1.patch", "header": "@@ -12,7 +12,7 @@" }
      ]
    }
  ]
}
```

`binary` 为 `true` 的文件没有 hunk，无法按 hunk 拆分。这类文件改用 `content` 模式提供完整内容。

执行器按顺序应用补丁。第 N 个补丁的上下文来自第 N-1 步提交后的内容。Git 会按上下文匹配并允许行号偏移。相邻的改动无法用 hunk 分开时，改用 `content` 模式。

`3way` 使用 `git apply --cached --3way`，需要补丁带 `index` 行且基准 blob 在对象库中。三方合并产生冲突时，执行器检测到 index 存在未解决的条目，返回 `patch_apply_failure` 并停止。

### `content`

`content` 把补丁文件当作该路径的完整中间状态。

结构化文件（JSON、YAML、TOML）适合这种模式。相邻改动无法用 hunk 表达语义边界时，为每一步生成一个中间状态文件：

```bash
# state-1.json 只含依赖安装
# state-2.json 含依赖安装和格式调整
# state-3.json 是最终内容
```

执行器把文件内容按 Git 的 clean filter 归一化后写入 index。因此中间状态文件用 LF 换行即可。

## 执行语义

语义执行器按以下顺序工作：

1. 检查暂存区。已有暂存内容时返回 `staged_changes_present` 并停止。
2. 校验计划。补丁缺失、路径越界、依赖成环时返回错误并停止。
3. 保存目标快照。用临时 index 从基线提交读入，再叠加工作区内容，得到范围路径的目标树。
4. 按依赖顺序逐步执行。每步先清空暂存区，再应用该步的补丁。
5. 检查暂存范围。补丁触碰的路径超出本步声明时返回 `patch_scope_mismatch`。
6. 提交。该步没有产生差异时记为 `skipped`。
7. 最终校验。比较最终 HEAD 树与目标树，并检查范围内的工作区和暂存区。

工作区文件在整个流程中保持不变。执行器不运行 `git add .`、`git commit -a`、`git reset --hard` 或 checkout 清理。

任一步失败时，执行器把 index 恢复到 HEAD。它不会把计划外内容留在暂存区，也不会留下半完成的状态。

路径按字面量处理。文件名含 `*`、`?`、`[` 或非 ASCII 字符时，Git 的转义与通配符展开都不会影响范围校验。

## 错误码

| 错误码 | 含义 |
|---|---|
| `staged_changes_present` | 执行前暂存区已有内容。 |
| `invalid_plan` | 计划结构、补丁引用或路径无效。 |
| `patch_apply_failure` | 补丁应用失败，或留下未解决的冲突。 |
| `patch_scope_mismatch` | 补丁或暂存结果超出本步声明的路径。 |
| `dependency_cycle` | `depends_on` 成环。 |
| `unsupported_operation` | 补丁含二进制、重命名或复制操作。 |
| `commit_failure` | `git commit` 失败，例如钩子拒绝。 |
| `target_verification_failure` | 最终 HEAD 与目标快照不一致。 |

## 不支持的操作

以下情况执行器在暂存前就显式失败，返回 `unsupported_operation`，不做猜测：

- 二进制补丁。需要提交二进制内容时用 `content` 模式。
- 重命名和复制。Git 的重命名格式无法用 `git apply` 表达。可以用 `content` 模式分别写删除和新增。
- 模式变更（可执行位、符号链接）。mode 只存在于 index，目标快照从工作区推导，表达不了它。

拒绝发生在提交之前。补丁不会被应用，暂存区保持为空，也不会产生提交。

## 结果契约

两种模式返回同一组字段，便于审计：

| 字段 | 含义 |
|---|---|
| `ok` | 是否成功 |
| `mode` | `semantic` 或 `file` |
| `completed_steps` | 已完成的步骤。语义模式是对象数组，文件级模式是步骤号数组 |
| `skipped_steps` | 被跳过的步骤。语义模式是对象数组，文件级模式是步骤号数组 |
| `commits` | 每个提交的 step、sha、subject、reason、paths、status |
| `base_head` / `final_head` | 执行前后的提交号 |
| `target_tree` / `final_tree` | 目标树与最终树。相等表示工作区目标被完整提交 |
| `verification` | 最终一致性结论。`status` 为 `verified` 或 `failed` |
| `git_log` | 最近若干条提交的一行摘要 |

语义模式的 `completed_steps` 与 `skipped_steps` 元素都带 `reason`，它回显计划里声明的语义组理由。被跳过的步骤另用 `skip_reason` 说明跳过原因。

## 委派

`-s` / `-sP` 委派时，子 Agent 在当前工作目录执行 `git-up -pc`，读同一份 SKILL.md。语义模式的补丁暂存、目标快照校验与错误码对委派执行完全一致。

委派只改变执行者，不改变提交边界。父 Agent 不重复 Git 调查、规划、暂存、提交或 push。子 Agent 失败后，父 Agent 只报告，不接管 Git 操作。

委派契约的测试只落在计划与结果的边界上，不复制子 Agent 内部行为。

## 快车道

以下任一条件成立时快车道必须回退，并在 `fallback_reasons` 中报告原因：

- 计划含 `changes`。
- 同一路径出现在多个步骤。
- 存在补丁文件或中间状态文件。
- 存在 `depends_on`。
- 补丁含不支持的操作。

检查命令：

```bash
node skills/git-up/scripts/inspect_fast_path.mjs --cwd . --plan-file .scratch/git-up/plan.yaml
```
