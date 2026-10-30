# ez-fast 的文档同步面

Status: open
Type: task
Parent: ../map.md
Blocked by: 01-ez-fast-parameter-contract.md, 02-ez-fast-split-granularity.md

## Question

ez-fast 落地后要改哪些文档、改哪几段？版本号与 marketplace 怎么同步？

## 需要产出的清单

按 AGENTS.md 的「新增 / 修改 / 删除 skill 的同步清单」，改动至少涉及以下文件：

| 文件 | 段落 | 改什么 |
| --- | --- | --- |
| `skills/git-up/SKILL.md` | frontmatter `argument-hint` | 加入 `-z` / `--ez-fast` |
| `skills/git-up/SKILL.md` | frontmatter `description` | 是否提及 ez-fast（触发词与用户口语「快速提交」「按文件提交」相关） |
| `skills/git-up/SKILL.md` | 模式表 | 新增一行：`-z` / `--ez-fast`，说明单独使用等价 `-p` |
| `skills/git-up/SKILL.md` | 新增「ez-fast 模式」章节 | 语法、组合矩阵、拆分粒度、检查放宽、被抑制拆分的报告方式 |
| `skills/git-up/SKILL.md` | 快车道章节 | 加交叉说明：ez-fast 上下文放宽规划质量级条件，Git 级条件不变 |
| `skills/git-up/SKILL.md` | 执行与安全边界 | 说明 `--ez-fast` 与 `--fast-path` 是两个独立 flag |
| `skills/git-up/SKILL.md` | 委派与 ignore | 委派描述模板加「使用 `-z`」 |
| `skills/git-up/SKILL.md` | 输出 | `-zp` 回显完整 YAML，`-zc` 只给 JSON 摘要 |
| `skills/git-up/README.md` | 快速开始 / 模式选择 | 新增 ez-fast 说明 |
| `skills/git-up/CHANGELOG.md` | 新版本条目 | 版本 2.7.0 → 2.8.0 |
| 根 `README.md` | git-up 参数速查 | 简写/等价/作用表新增 `-z` 行；调用示例补 `-zpc` |
| 根 `README.md` | git-up `<details>` 块 | 「语义拆分提交」旁新增「ez-fast 模式」块，说明与语义模式的关系 |
| `.claude-plugin/marketplace.json` | git-up 条目 | `version` 改 2.8.0，`description` 补 ez-fast |
| `skill-zips/git-up.zip` | 打包产物 | 重新打包 |

## 待定

- ez-fast 章节放 `skills/git-up/SKILL.md` 正文，还是独立成 `skills/git-up/references/ez-fast.md` 由 SKILL.md 引用。参照 `references/semantic-commit.md` 的做法 —— 语义模式内容较多时独立成文。ez-fast 内容量未知，待实现轮定。
- 根 README 的「参数说明只在根 README 维护一处」约束：ez-fast 的参数表放根 README，完整流程放 skill 文档，两者不重复。
- 版本号是否走 2.8.0（新增能力，非破坏性变更）。

## 备注

本工单是 task。需要动手把每个文件的每个段落列全，产出实施清单。

前置：工单 01 已定语法与组合矩阵，工单 02 已定拆分粒度。
