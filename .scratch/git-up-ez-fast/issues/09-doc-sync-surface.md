# ez-fast 的文档同步面

Status: resolved
Type: task
Parent: ../map.md
Blocked by: 01-ez-fast-parameter-contract.md, 02-ez-fast-split-granularity.md

## Question

ez-fast 落地后要改哪些文档、改哪几段？版本号与 marketplace 怎么同步？

## 决议（实施清单，实现轮照此执行）

### 结构决定：独立 `skills/git-up/references/ez-fast.md`

用户已确认（2026-10-31）：ez-fast 详情独立成文，不走 SKILL.md 正文承载。理由与 `references/semantic-commit.md` 先例一致——SKILL.md 自 v1.4 起按渐进披露瘦身，主文件只留常用路径；组合矩阵 + 判据 + 结果契约展开超 40 行。

**`references/ez-fast.md` 承载**（新文件）：
- 参数语法与组合矩阵（工单 01 全表：`-z`/`-zp`/`-zc`/`-zpc`/`-zs`/拒绝 `-zd`/`-zi`/`-P`/`-l` 照常）
- 拆分粒度与 `depends_on`（工单 02）
- 检查放宽边界：规划质量级 vs Git 级清单表（工单 03）
- `suppressed_split` 判据：结构化文件清单、排除清单、增删整块规则、「尽力而为不保证完整」措辞（工单 07）
- 结果契约：`semantic_split_disabled`/`suppressed_split` 字段表（工单 05）
- 与快车道的正交关系（工单 06）
- 错误行为：语义计划 `invalid_plan`、路径归属校验（工单 04/07）

**SKILL.md 承载**（增量 ≤15 行）：模式表一行 + 十行以内小节。

CONTEXT.md 不写 ez-fast 术语（沿用上一张图先例：该文件只承载 project-self-memory 域术语）。

### 逐文件改动清单

| 文件 | 段落 | 改什么 |
| --- | --- | --- |
| `skills/git-up/SKILL.md` | frontmatter `argument-hint` | 加 `-z` / `--ez-fast`（放在 `-i` 之前，保持模式参数连排） |
| `skills/git-up/SKILL.md` | frontmatter `description` | 触发词补 `-z`、`--ez-fast`、`快速提交`、`按文件提交` |
| `skills/git-up/SKILL.md` | frontmatter `version` | 2.7.0 → 2.8.0（新增能力，非破坏性） |
| `skills/git-up/SKILL.md` | 模式表 | 新增一行：`-z` / `--ez-fast` | ez-fast 模式，单独使用等价 `-p`，只按文件拆分并放宽规划质量检查 |
| `skills/git-up/SKILL.md` | 新增「ez-fast 模式」小节 | ≤10 行：定义（按文件拆 + 放宽文件数/跨模块 + 禁语义计划）、组合速查（`-zp`/`-zc`/`-zpc`）、`suppressed_split` 一句话 + 「尽力而为」措辞、链接 `references/ez-fast.md` |
| `skills/git-up/SKILL.md` | 快车道章节 | 加一句交叉引用：`-zpc` 下快车道判定放宽文件数与跨模块，Git 级条件不变，详见 references/ez-fast.md |
| `skills/git-up/SKILL.md` | 执行与安全边界 | `--ez-fast` 与 `--fast-path` 是两个独立 flag，语义计划遇 `--ez-fast` 返回 `invalid_plan` |
| `skills/git-up/SKILL.md` | 委派与 ignore | 委派描述模板补「使用 `-z`」一项 |
| `skills/git-up/SKILL.md` | 输出 | 补两行：`-zp` 回显完整 YAML；`-zc` 只给 JSON 摘要 |
| `skills/git-up/references/ez-fast.md` | 新文件 | 内容范围见上节 |
| `skills/git-up/README.md` | 模式选择/快速开始 | 补 ez-fast 一段（三行以内）+ 详情链接指向 references/ez-fast.md |
| `skills/git-up/CHANGELOG.md` | 新版本条目 | `## 2.8.0 - 2026-10-XX`：新增 ez-fast 模式（`-z`/`--ez-fast`），含 `suppressed_split` 结果契约、检查放宽边界、`--ez-fast` flag 与 `invalid_plan` 拒绝 |
| 根 `README.md` | git-up 参数速查 | 简写表新增 `-z` 行（等价 `--ez-fast`）；调用示例补 `$git-up -zpc`；注意事项一句「-z 禁止语义计划，违者 invalid_plan」 |
| 根 `README.md` | git-up `<details>` 详情块 | 「语义拆分提交」旁新增「ez-fast 模式」块：与语义模式互斥、按文件拆分、详情链接 |
| `.claude-plugin/marketplace.json` | git-up 条目 | `version` → 2.8.0；`description` 补「支持 -z/--ez-fast 快速按文件拆分提交」 |
| `skill-zips/git-up.zip` | 打包产物 | `node scripts/package-skills.mjs --skill git-up` 重新打包（实现轮验证步骤最后执行） |

### 版本与校验

- 版本号走 **2.8.0**（minor：新增能力）。
- 按仓库约定：marketplace.json 改后跑 `node -e "JSON.parse(...)"` 校验合法性；根 README 详情链接逐一确认无断链。
- 遵守「参数说明只在根 README 维护一处」：参数表只在根 README 与 references/ez-fast.md（组合矩阵属流程细节），SKILL.md 不重复列参数表。

## 备注

前置工单 01、02、07、08 均已 resolved。本清单是九张工单中最后一张，完成后即可进实现轮：先 08 的脚本清单，再本清单的文档面，最后打包验证。

## 实施记录

实现轮已完成（提交 `34aa45a`，打包提交 `294f694`）。16 项逐文件清单全部落实，版本走 2.8.0。

两处实施期的发现：

- `SKILL.md` 净增 15 行，正好在「增量 ≤15 行」的预算内。模式表一行、ez-fast 小节两段、快车道与执行边界的交叉引用、委派模板与输出两行分别占位。
- `references/ez-fast.md` 的检查放宽边界表原先把「无改动」列在规划质量级类别下，与工单 08 把 `no_changes` 归入 Git 级条件不一致。已连同根 README 与检查器 USAGE 的 Git 级条件清单一并对齐（提交 `8954279`）。

`CHANGELOG.md` 的版本条目写作 `## [2.8.0] - 2026-10-31`，用方括号跟随仓库既有的 2.7.0 / 2.5.0 写法，未按本工单字面写成 `## 2.8.0`。
