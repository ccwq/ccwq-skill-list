# 脚本与资源组织

> 译编自 https://agentskills.io/skill-creation/using-scripts（调研于 2026-11-13）。主文档见 [`../../agent-skill规范.md`](../../agent-skill规范.md)。

---

## 1. 一次性命令 vs 打包脚本

**当已有工具包能直接满足需求时**，在 SKILL.md 里直接引用命令即可，不必建 `scripts/` 目录。许多生态提供运行时自动解析依赖的工具：

| 工具 | 说明 |
|------|------|
| `uvx` | 在隔离环境运行 Python 包，激进缓存，重复运行近乎瞬时（随 uv 分发） |
| `pipx` | 需要单独安装；`pipx run` 也支持 PEP 723 |
| `npx` | 运行 npm 包 |
| `bunx` | 运行 Bun 包 |
| `deno run` | 运行 Deno 脚本 |
| `go run` | 运行 Go 程序 |

```bash
uvx ruff@0.8.0 check .
uvx black@24.10.0 .
```

一次性命令的三条规则：

1. **固定版本**（如 `npx eslint@9.0.0`），让命令行为随时间不变。
2. **在 SKILL.md 或 `compatibility` 中声明前置条件**（如 "Requires Node.js 18+"），不要假设 agent 环境里已装好。
3. **命令复杂了就搬进脚本**。带两三个 flag 的调用用一次性命令合适；一旦复杂到难以一次写对，就该用 `scripts/` 下经过测试的脚本。

---

## 2. 从 SKILL.md 引用脚本

用**相对 skill 目录根**的路径，agent 会自动解析，不需要绝对路径。

先在 SKILL.md 里列出可用脚本，让 agent 知道它们存在：

```markdown
## 可用脚本

- **`scripts/validate.sh`** —— 校验配置文件
- **`scripts/process.py`** —— 处理输入数据
```

再指示 agent 如何运行：

```markdown
## 工作流

1. 运行校验脚本：
   ```bash
   bash scripts/validate.sh "$INPUT_FILE"
   ```

2. 处理结果：
   ```bash
   python3 scripts/process.py --input results.json
   ```
```

同一套相对路径约定在 `references/*.md` 等支撑文件里同样适用 —— **代码块里的脚本执行路径相对 skill 目录根**，因为 agent 是从那里执行命令的。

---

## 3. 自包含脚本

需要复用逻辑时，把脚本放进 `scripts/`，并在脚本内联声明依赖 —— agent 一条命令就能跑，不需要单独的 manifest 或安装步骤。

多种语言支持内联依赖声明：Python、Deno、Bun、Ruby。

Python 用 PEP 723 标准格式，在 `# ///` 标记内写 TOML 元数据：

```python
# /// script
# dependencies = [
#   "beautifulsoup4",
# ]
# ///

from bs4 import BeautifulSoup

html = '<html><body><h1>Welcome</h1><p class="info">This is a test.</p></body></html>'
print(BeautifulSoup(html, "html.parser").select_one("p.info").get_text())
```

运行：

```bash
uv run scripts/extract.py
```

`uv run` 会创建隔离环境、安装声明的依赖并执行脚本；`pipx run scripts/extract.py` 同样支持 PEP 723。

- 用 PEP 508 语法固定版本：`"beautifulsoup4>=4.12,<5"`
- 用 `requires-python` 约束 Python 版本
- 用 `uv lock --script` 生成 lockfile 获得完全可复现的环境

---

## 4. 为 agent 而人设计的脚本接口

agent 运行脚本时读 stdout 与 stderr 来决定下一步。接口设计直接影响 agent 的成功率。

### 4.1 绝不交互（硬性要求）

agent 跑在**非交互 shell** 里，无法响应 TTY 提示、密码框或确认菜单。脚本一旦阻塞等待输入就会永久挂起。

所有输入走命令行参数、环境变量或 stdin：

```python
# 坏：等待输入，会挂起
$ python scripts/deploy.py
Target environment: _

# 好：直接报错并给出指引
$ python scripts/deploy.py
Error: --env is required. Options: development, staging, production.
Usage: python scripts/deploy.py --env staging --tag v1.2.3
```

### 4.2 用 `--help` 记录用法

`--help` 是 agent 学习脚本接口的主要途径。写清简介、可选参数与用例：

```
Usage: scripts/process.py [OPTIONS] INPUT_FILE

Process input data and produce a summary report.

Options:
  --format FORMAT    Output format: json, csv, table (default: json)
  --output FILE      Write output to FILE instead of stdout
  --verbose          Print progress to stderr

Examples:
  scripts/process.py data.csv
  scripts/process.py --format csv --output report.csv data.csv
```

保持简洁 —— 这段输出会进入 agent 的上下文窗口。

### 4.3 写有用的错误信息

agent 拿到错误时，错误信息直接决定它下一步怎么试。含糊的 `Error: invalid input` 白白浪费一轮。要说清：**哪里错了、期望什么、可以怎么办**。

```
Error: --format must be one of: json, csv, table.
       Received: "xml"
```

### 4.4 用结构化输出

优先 JSON / CSV / TSV 这类结构化格式，而非自由文本 —— agent 与标准工具（`jq`、`cut`、`awk`）都能消费，便于在管道里组合。

```
# 空格对齐 —— 程序难解析
NAME          STATUS    CREATED
my-service    running   2025-01-15

# 分隔明确 —— 字段边界无歧义
{"name": "my-service", "status": "running", "created": "2025-01-15"}
```

**数据与诊断分离**：结构化数据走 stdout，进度、告警等诊断信息走 stderr。这样 agent 拿到干净的 stdout，同时仍能拿到诊断信息。

### 4.5 其它考量

| 考量 | 做法 |
|------|------|
| **幂等** | agent 可能重试命令。"不存在才创建"优于"重复则失败" |
| **输入约束** | 遇到歧义输入直接明确报错，而不是猜。尽量用枚举与封闭集合 |
| **Dry-run** | 破坏性或有状态的操作提供 `--dry-run`，让 agent 先预览 |
| **有意义的退出码** | 不同失败类型（未找到、参数非法、认证失败）用不同退出码，并在 `--help` 中说明含义 |
| **安全默认值** | 破坏性操作是否需要显式确认标志（`--confirm`、`--force`），按风险等级定 |
| **输出大小可预测** | 很多 harness 会截断超过阈值的工具输出（如 10–30K 字符）。大输出默认给摘要或限制条数，并支持 `--offset` 之类参数；不便分页时，要求 agent 传 `--output FILE`（`-` 表示显式输出到 stdout） |

---

## 5. 资源目录分工

| 目录 | 内容 | 加载方式 |
|------|------|----------|
| `scripts/` | 可执行代码 | 被调用时 |
| `references/` | 补充文档：`REFERENCE.md`（详细技术参考）、`FORMS.md`（表单模板或结构化数据格式）、领域文件（`finance.md`、`legal.md` 等） | 按需加载 |
| `assets/` | 静态资源：文档/配置模板、图片与示意图、查找表与 schema | 需要产出物时 |

`references/` 里的单个文件应保持聚焦 —— agent 按需加载，文件越小占用上下文越少。

---

## 6. 本仓库补充约定

- **skill 内脚本一律 Node.js（`.mjs`，ESM）**，不引入 Python 运行时依赖；仓库根的 `scripts/` 也已按此约定组织（`package-skills.mjs`、`sync-main-skill-manifest.mjs`、`zip.mjs` 等）。
- 仓库根 `scripts/init-skill.py` 是**一次性脚手架**，不属于任何 skill 的 `scripts/` 目录。
- Windows 环境下脚本路径使用正斜杠或双反斜杠，避免转义问题；跨平台脚本应显式处理路径分隔符。
