# Agent Skill 规范

> **依据**：https://agentskills.io —— Agent Skills 开放标准（Anthropic 发起，现由 LF Projects, LLC 托管）。
> **调研快照**：2026-11-13，译编自官方全部 9 个页面中的 Specification、Best practices、Optimizing descriptions、Using scripts、Adding skills support。
> **适用范围**：本仓库 `skills/` 下所有 Skill 的创建与修改。仓库的安装索引与同步清单见 `AGENTS.md`。

---

## 0. 三层约束的关系

写本仓库的 Skill 时，同时受三层约束。冲突时按层序取值：**格式层 > 流程层 > 扩展层**。

| 层级 | 来源 | 效力 | 违反后果 |
|------|------|------|----------|
| 官方格式层 | agentskills.io Specification | 硬约束，跨客户端兼容底线 | 其它客户端可能不识别、不加载 |
| 仓库流程层 | 本文档 + `AGENTS.md` | 本仓库内部约定 | 安装索引与插件入口不一致 |
| 客户端扩展层 | Claude Code 等私有 frontmatter 字段 | 可移植性弱，仅本仓库内使用 | 跨客户端时字段被忽略 |

---

## 1. 目录结构

### 1.1 本仓库布局

```
skills/
└── <skill-name>/              # 目录名 == frontmatter 的 name
    ├── SKILL.md                # 必需：frontmatter + 正文
    ├── CHANGELOG.md            # 仓库约定：变更记录（覆盖率非 100%，建议但非强制）
    ├── README.md               # 可选：面向人的安装/使用说明
    ├── scripts/                # 可选：可执行脚本
    ├── references/             # 可选：按需加载的参考文档
    ├── assets/                 # 可选：模板、图片、数据
    └── evals/                  # 仓库约定：触发/输出评测用例
```

### 1.2 客户端扫描位置（官方不强制目录位置）

官方规范**只定义 skill 目录里放什么**，不规定它必须在哪。各客户端的实际扫描位置：

| 作用域 | 路径 | 用途 |
|--------|------|------|
| 项目级 | `<project>/.agents/skills/` | 跨客户端互操作约定 |
| 项目级 | `<project>/.claude/skills/` | Claude Code 原生位置 |
| 用户级 | `~/.agents/skills/` | 跨客户端互操作约定 |
| 用户级 | `~/.claude/skills/` | Claude Code 原生位置 |

发现规则：扫描各 skills 目录下的**子目录**，凡含恰好名为 `SKILL.md` 的文件即视为一个 skill；`README.md` 这类文件本身不算 skill 目录。实现上应跳过 `.git/`、`node_modules/`，可选尊重 `.gitignore`，并设最大深度与目录数上限。

同名冲突时的通用优先级：**项目级覆盖用户级**；同层级冲突按"先找到者胜"或"后找到者胜"皆可，但必须固定一种并打日志告警。

> 本仓库选择 `skills/<name>/` 作为源码布局，通过 `npx skills add` 或插件市场分发；这不影响 skill 内部格式。

---

## 2. SKILL.md 语法

一个 SKILL.md = **YAML frontmatter**（`---` 包裹）+ **Markdown 正文**。

```
---
name: skill-name
description: 一句话说明这个 skill 做什么、何时该用它。
---

# 正文：agent 激活后执行的指令
```

### 2.1 必填字段（硬约束）

| 字段 | 约束 |
|------|------|
| `name` | 1–64 字符；仅 `a-z`、`0-9`、`-`；不得以 `-` 开头或结尾；不得含连续 `--`；**必须与父目录名完全一致** |
| `description` | 1–1024 字符；非空；须同时说明「做什么」和「何时用」 |

合法 / 非法 `name`：

```yaml
name: pdf-processing      # 合法
name: data-analysis       # 合法

name: PDF-Processing      # 非法：大写
name: -pdf                # 非法：以连字符开头
name: pdf--processing     # 非法：连续连字符
name: 数据处理             # 非法：非 ASCII 字母数字
```

> **命名规范（官方）**：禁止使用冒号分组。本仓库 `AGENTS.md` 已据此修订为「主名称与子名称使用连字符分隔（如 `领域-名称`）」。

`description` 合格示例：

```yaml
# 好：做了什么 + 何时用 + 具体关键词
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.

# 差：信息量不足，agent 无法判断何时触发
description: Helps with PDFs.
```

### 2.2 可选字段（官方定义，共 4 个）

| 字段 | 约束 | 用途 |
|------|------|------|
| `license` | 简短，许可证名或仓库内许可证文件名 | 声明授权 |
| `compatibility` | 1–500 字符 | 环境要求：目标产品、系统依赖、网络访问等。多数 skill 不需要 |
| `metadata` | 字符串键 → **字符串值** 的映射 | 承载规范未定义的附加信息 |
| `allowed-tools` | 空格分隔的字符串 | 预授权工具（实验性，各客户端支持度不一） |

示例：

```yaml
license: Apache-2.0
compatibility: Requires git, docker, jq, and access to the internet
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Bash(jq:*) Read
```

> `metadata` 的官方定义是 **string → string**。写成 YAML 数组或嵌套对象（如 `tags: [a, b]`）不符合官方定义，跨客户端解析可能失败；需要列表时请用逗号连接的单个字符串。

### 2.3 本仓库扩展字段白名单（非官方，跨客户端不可移植）

以下字段在 Claude Code 等客户端有效，官方规范未定义。使用它们时：

1. 不得让扩展字段成为 skill 唯一的存在依据 —— `name` 与 `description` 必须自洽；
2. 需要长期维护的版本号，写在 `metadata.version`（官方字段）；顶层 `version` 属于遗留写法，本仓库已于 2026-11-13 全部迁移完毕，新 skill 不得再用；
3. 迁移期两种写法并存可接受，但同一仓库内应收敛到 `metadata.version`。

| 字段 | 语义 | 备注 |
|------|------|------|
| `version` | skill 语义版本 | 官方无此字段；本仓库已统一迁至 `metadata.version`，顶层写法视为遗留 |
| `argument-hint` | 斜杠命令的参数提示 | 例如 `git-up` 的 `[-p\|-c\|-pc\|-g ...]` |
| `disable-model-invocation` | `true` 时禁止模型自动调用，仅允许用户显式触发 | 本仓库多数 skill 采用 |
| `summary` | 一句话摘要，用于列表展示 | 与 `description` 区分：`summary` 给人看，`description` 给模型判断触发 |

### 2.4 YAML 书写规范

**最常见事故：未加引号的值里出现冒号。** 下面这行技术上是非法 YAML，多数解析器会报错或截断：

```yaml
description: Use this skill when: the user asks about PDFs
```

修法有二：加引号，或改用块标量。

```yaml
description: "Use this skill when: the user asks about PDFs"

# 多行描述推荐用块标量（> 折叠、| 保留换行）
description: |
  Git 提交工具：生成 commit message、规划或执行提交、语义拆分。
  用户要求提交、规划、生成提交信息时使用。
```

客户端实现方的建议是：解析失败时，先尝试把该值加引号或转成块标量再重试，仍失败则跳过该 skill 并记录错误。仓库内所有 SKILL.md 都要保证是**合法 YAML**。

### 2.5 完整模板

最小模板：

```yaml
---
name: skill-name
description: 这个 skill 做什么，用户在什么情况下会需要它。
---

# 标题

## 何时使用

## 执行步骤

1. …

## 输出

## 边界与坑
```

本仓库推荐模板：

```yaml
---
name: skill-name
description: |
  一句话说明这个 skill 做什么 + 何时触发（含具体关键词）。
metadata:
  version: "1.0.0"
---

# 标题

## 概述

## 使用场景

## 输入

## 输出

## 示例
```

---

## 3. 正文（body）写法

正文**没有格式限制**，但应满足：

- **写 agent 不知道的东西**：项目约定、领域流程、非显然的边界条件、具体工具与 API。解释「什么是 PDF」是浪费 token。
- **只写可复用方法，不写单个实例的答案**：给方法与数据流（"按 `_id` 外键约定连接表"），而不是某一次查询的 SQL。
- **给默认解，不是菜单**：明确首选方案，备选方案一句话带过。
- **按脆弱度控制指令粒度**：脆弱流程写死命令序列；灵活流程说明意图即可。
- **推荐结构**：概览 → 何时使用 → 分步执行 → 输入/输出 → 边界与坑 → 示例。
- **规模建议（官方推荐值，非硬限制）**：SKILL.md 正文控制在 500 行、5000 token 以内。超出的内容移到 `references/` 或 `assets/`。

详见 `docs/agent-skill/references/best-practices.md`。

---

## 4. 渐进披露（Progressive Disclosure）

Agent 加载 skill 分三阶段，每一层的成本决定了内容该放哪：

| 层级 | 加载内容 | 加载时机 | Token 成本 |
|------|----------|----------|-----------|
| 1 目录 | `name` + `description` | 会话启动，所有 skill 全量加载 | ~50–100 token / skill |
| 2 指令 | SKILL.md 正文全文 | 命中该 skill 时 | 官方推荐 <5000 token |
| 3 资源 | `scripts/`、`references/`、`assets/` | 正文引用到时按需加载 | 视情况 |

推论：**`description` 承担了全部触发责任**。它既不能过窄（该触发时没触发），也不能过宽（不该触发时乱触发）。写法与验评流程见 `references/description-and-eval.md`。

---

## 5. 脚本与资源

| 目录 | 装什么 | 加载时机 |
|------|--------|----------|
| `scripts/` | 可执行代码 | 被调用时 |
| `references/` | 补充文档、模板、数据格式说明 | 被引用时 |
| `assets/` | 模板、图片、查找表 | 需要产出物时 |

引用规则：用**相对 skill 根目录**的路径，不要绝对路径；引用深度**只允许一层**（SKILL.md → references/x.md），避免链式引用。

脚本设计要点（面向 agent 而非人）：

- **绝不交互**：agent 跑在非交互 shell 里，阻塞在 TTY 提示上会永久挂起。所有输入走命令行参数、环境变量或 stdin。
- **带 `--help`**：这是 agent 学习脚本接口的主要途径，写清用途、参数、示例。
- **错误信息要有用**：写明「哪里错了、期望什么、可以怎么办」，而不是 `Error: invalid input`。
- **结构化输出**：优先 JSON/CSV/TSV；数据走 stdout，诊断信息走 stderr。
- **幂等**：agent 会重试命令，"不存在才创建"优于"重复则失败"。
- **退出码有意义**：不同失败类型用不同退出码，并在 `--help` 中说明。
- **输出大小可控**：很多 harness 会截断超过 10–30K 字符的工具输出。大输出默认给摘要，或要求 `--output FILE`（`-` 表示显式输出到 stdout）。
- **破坏性操作提供 `--dry-run`**，必要时加 `--confirm` / `--force`。

一次性命令可直接在正文引用运行时工具，不必打包成脚本：`uvx`、`pipx`、`npx`、`bunx`、`deno run`、`go run`。**固定版本**（`npx eslint@9.0.0`），并在正文或 `compatibility` 中声明环境前置要求。

需要自包含脚本时，用内联依赖声明：Python 用 PEP 723（`# /// script` 块），Deno/Bun/Ruby 各有对应格式；用 `uv run scripts/extract.py` 执行，依赖由运行时隔离安装。

详见 `docs/agent-skill/references/scripts-and-resources.md`。

---

## 6. `description` 写法与触发验评

摘要版规则（详细流程见 `docs/agent-skill/references/description-and-eval.md`）：

1. **用命令式句式**：`Use this skill when…`，而不是 `This skill does…`。
2. **写用户意图，不写内部实现**：agent 匹配的是用户说的话。
3. **主动扩张场景**：明确列出用户不会明说领域名的情形，例如 "even if they don't explicitly mention 'CSV'"。
4. **保持简洁**：几句话到一小段；硬上限 1024 字符。
5. **关键词要具体**：写领域词、动作词、常见说法，不要写空泛的"帮助你处理文件"。

---

## 7. 本仓库落地约束

| 项 | 要求 |
|----|------|
| 名称 | 小写字母 + 数字 + 连字符；与目录名一致；**不使用冒号** |
| 位置 | `skills/<name>/SKILL.md` |
| 版本 | 统一写在 `metadata.version`；顶层 `version` 为遗留写法，新 skill 禁用 |
| 变更记录 | 建议随 skill 提供 `CHANGELOG.md`（当前仓库非全覆盖） |
| 依赖 | skill 内脚本用 **Node.js（`.mjs`，ESM）**，不引入 Python 运行时依赖 |
| README | 根 README 承担**安装索引 + 参数速查**；详细流程写在各 skill 自己的 `SKILL.md` / `README.md` |
| 参数说明 | 只在根 README 维护一份，skill 文档不重复列参数 |
| 插件入口 | `.claude-plugin/marketplace.json` 的 `plugins` 与根 README 索引必须同步 |
| 插件条目命名 | `marketplace.json` 条目的 `name` 必须与其 `source` 指向的目录名一致（也与该 skill 的 `name` 一致） |

新增 / 修改 / 删除 skill 的**完整同步清单**见 `AGENTS.md`「新增 / 修改 / 删除 skill 的同步清单」。这里只列检查要点：

- [ ] 根 README「可用 Skill」索引表有对应行（名称、一句说明、详情链接）
- [ ] 根 README「参数速查」有对应小节（调用示例 + 参数表 + 注意事项）
- [ ] `.claude-plugin/marketplace.json` 的 `plugins` 数组有对应条目（`name`/`source`/`description`/`version`/`category`）
- [ ] README 详情链接路径真实存在，无断链
- [ ] `marketplace.json` 是合法 JSON
- [ ] `node scripts/validate-skill.mjs` 全部通过（0 错误）

---

## 8. 新建与修改 skill 的流程

### 8.1 新建

1. **立项检查**：确认没有同名或语义重叠的 skill（可用 `skill-doctor` 扫描冲突）。
2. **脚手架**：
   ```bash
   python scripts/init-skill.py <skill-name> --title "标题" --description "一句话说明"
   ```
   生成 `skills/<name>/SKILL.md` 与 `CHANGELOG.md`。模板中的版本号写在 `metadata.version`（符合官方 `metadata` 字段定义）。
3. **编写 SKILL.md**：按 §2.5 模板写 frontmatter，正文按 §3 组织；细节拆到 `references/`。
4. **写 description**：按 §6 与 `references/description-and-eval.md` 打磨。
5. **校验**：`node scripts/validate-skill.mjs <name>`（详见 §9）。
6. **同步索引**：按 §7 检查要点更新根 README 与 `marketplace.json`。
7. **评测**（可选但推荐）：放 `evals/trigger-queries.json`，用触发用例验证该 skill 会被正确命中。

### 8.2 修改

1. 改动 SKILL.md 后重跑校验。
2. 语义/接口变化 → 升版本 + 写 `CHANGELOG.md`。
3. 检查根 README 与 `marketplace.json` 中的描述是否需要同步更新（尤其 `description` 改动会直接影响触发）。

---

## 9. 校验

### 9.1 仓库校验脚本

```bash
node scripts/validate-skill.mjs              # 校验全部 skill
node scripts/validate-skill.mjs git-up       # 只校验指定 skill
node scripts/validate-skill.mjs --strict     # 把警告也当作失败
```

检查项：

- frontmatter 存在且可解析，键不重复
- `name` 存在、字符集合法、长度 ≤64、且与目录名一致
- `description` 存在、非空、长度 ≤1024
- 标量值不含未加引号的冒号（YAML 陷阱）
- `metadata` 为映射且各值为字符串（官方 string→string）
- `compatibility` 长度 ≤500
- 未知字段告警；顶层 `version` 告警（应写在 `metadata.version`）
- `evals/trigger-queries.json` 存在时，校验 JSON 合法且正负例齐全
- 根 README 索引、`.claude-plugin/marketplace.json` 条目与 skill 目录三方一致，且 marketplace 条目名与目录名一致

退出码：0 = 通过，1 = 存在错误，2 = 用法错误。

### 9.2 官方参考实现

官方参考库 `skills-ref`（位于 GitHub `agentskills/agentskills/skills-ref`）可校验 frontmatter 与命名约定：

```bash
skills-ref validate ./skills/<skill-name>
```

该库的具体安装方式以其仓库说明为准。

---

## 10. 常见错误对照

| 现象 | 原因 | 修法 |
|------|------|------|
| 客户端不识别该 skill | `SKILL.md` 缺失、文件名大小写不对、或目录里没有该文件 | 文件名必须恰好是 `SKILL.md` |
| 部分客户端解析报错 | frontmatter 里的值含未加引号的冒号 | 加引号或改用块标量 `|` / `>` |
| skill 从不触发 | `description` 太窄，或写成了「这个 skill 做什么」而非「何时用」 | 改写为命令式句式，补关键词与场景 |
| skill 老是误触发 | `description` 太宽，缺少边界说明 | 补「不做什么」，并加入 should-not-trigger 用例 |
| 目录改名后仍被扫描到 | `name` 与目录名不一致 | 官方建议两者完全一致 |
| agent 读不到引用文件 | 用了绝对路径或深层链式引用 | 改为相对 skill 根的一层引用 |
| agent 卡在脚本上 | 脚本等待交互输入 | 改为参数/环境变量/stdin 输入 |
| 长脚本输出被截断 | 超过 harness 输出上限 | 默认输出摘要，或要求 `--output FILE` |

---

## 11. 官方参考

| 页面 | 地址 |
|------|------|
| 概览 | https://agentskills.io/home |
| **规范（Specification）** | https://agentskills.io/specification |
| 最佳实践 | https://agentskills.io/skill-creation/best-practices |
| description 优化与触发验评 | https://agentskills.io/skill-creation/optimizing-descriptions |
| 输出质量评估 | https://agentskills.io/skill-creation/evaluating-skills |
| 脚本使用 | https://agentskills.io/skill-creation/using-scripts |
| 客户端接入实现 | https://agentskills.io/client-implementation/adding-skills-support |
| 快速上手 | https://agentskills.io/skill-creation/quickstart |
| 参考实现（skills-ref） | https://github.com/agentskills/agentskills/tree/main/skills-ref |

---

## 12. 本文档的 references

| 文件 | 内容 |
|------|------|
| [`agent-skill/references/best-practices.md`](agent-skill/references/best-practices.md) | 指令写法模式：gotchas、输出模板、清单、验证循环、plan-validate-execute、脚本化信号 |
| [`agent-skill/references/description-and-eval.md`](agent-skill/references/description-and-eval.md) | `description` 写法要点、触发用例设计、train/validation 切分与触发率计算 |
| [`agent-skill/references/scripts-and-resources.md`](agent-skill/references/scripts-and-resources.md) | 脚本接口设计细节、资源目录分工、one-off 命令与自包含脚本 |
