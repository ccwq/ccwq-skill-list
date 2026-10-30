# 提交计划格式

`commit_plan.mjs` 读入的提交计划格式。这是唯一权威说明。语义模式的专属字段见 [semantic-commit.md](semantic-commit.md)。

## 计划结构

计划是 YAML Lite，不是完整 YAML。它是顶层列表，每项一个提交步骤。

```yaml
- step: 1
  subject: "feat(scope): ✨主题"
  body: |
    - 第一项改动
    - 第二项改动
  foot: "Refs: #12"
  files:
    - src/example.ts
```

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `step` | 是 | 步骤号，整数。`depends_on` 引用这个号。 |
| `subject` | 是 | 提交标题。非空。 |
| `body` | 否 | 提交正文。多行写法见下。 |
| `foot` | 否 | 提交脚注，例如 `Refs: #12`。多行写法见下。 |
| `reason` | 否 | 该提交组存在的理由。只用于审阅，不进入提交信息。 |
| `depends_on` | 否 | 前置步骤号列表。必须写成列表，例如 `depends_on: [1]`。 |
| `files` | 文件级模式必填 | 该提交包含的仓库相对路径列表。 |
| `changes` | 语义模式必填 | 该提交的补丁清单。语义模式每个步骤都必须声明它。 |

文件级模式声明 `files`，执行器只 `git add -- <files...>`。语义模式声明 `changes`。含 `files` 的步骤在语义模式下会被拒绝，语义模式不回退到文件级暂存。

一个路径可以出现在多个步骤。语义模式的 `changes` 子字段见 [semantic-commit.md](semantic-commit.md)。

## 多行正文

`body` 与 `foot` 用块标量写多行。首行写 `|`、`|-` 或 `|+`，内容缩进四空格。

```yaml
- step: 1
  subject: "feat(scope): ✨主题"
  body: |-
    - 第一项改动
    - 第二项改动
  files:
    - src/example.ts
```

三种写法的内容相同。尾部换行的差异不保留。

折叠写法 `>` 与显式缩进标记（`|2`）不支持。计划写了它们，执行器返回 `invalid_plan`。

引号包裹的值不是块标量首行。`body: "|"` 是字面量竖线。

## 缩进规则

| 位置 | 缩进 |
|---|---|
| 步骤字段 | 两空格 |
| 块标量内容 | 四空格 |
| `files` 与 `depends_on` 条目 | 四空格 |
| `changes` 条目 | 四空格 |
| `changes` 条目的续行字段 | 六空格 |

缩进不足时执行器返回 `indent`，行号指向出错的那一行。

## 解析错误码

| 错误码 | 触发条件 |
|---|---|
| `invalid_plan` | 计划结构无效。含折叠块标量、列表字段误用块标量、依赖不是列表、路径越界、补丁文件缺失、依赖成环。 |
| `indent` | 缩进不符。含块标量内容不足四空格、列表条目缩进不对。 |
| `syntax` | 行不是 `key: value` 形式，或计划不是顶层列表。 |
| `missing_field` | 缺 `step` 或 `subject`，或 `subject` 为空。 |
| `missing_files` | 文件级模式的步骤缺 `files` 或 `files` 为空。 |
| `invalid_files` | `files` 条目为空。 |
| `empty_plan` | 计划没有任何步骤。 |
| `invalid_step` | `step` 的值不是整数。 |

语义模式的执行期错误码见 [semantic-commit.md](semantic-commit.md)。

## 已知限制

`body` 与 `foot` 的首行不留相对缩进。块内容首行比后续行缩进更多时，缩进会被去掉。
