---
name: git-up
version: 2.6.0
argument-hint: "[--plan|-p|--discuss|-d|--modify <内容>|--commit|-c|-pc|-pcP|--sub-agent|-s|-sP|--ignore|-i] [--push|-P] [-l zh|en] [提交约束]"
description: |
  Git 提交综合工具：分析改动、生成规范 commit message、规划并以显式文件列表执行提交。
  用户提到“提交代码”“commit 一下”“git up”“拆 commit”“规划提交”“提交并 push”“生成 commit message”、
  `-p`、`-c`、`-pc`、`-pcP`、`-s`、`-sP` 或维护 `.gitignore` 时使用。
---

# Git-up

根据用户传入模式执行，不混入其它模式。默认使用中文；`-l en` 时将计划、提交信息和汇报改为英文。

| 模式 | 作用 |
|---|---|
| 默认 | 只生成一条 commit message，不规划、不提交。 |
| `-p` | 只输出可审阅的 YAML 计划。 |
| `-d` / `--modify` | 围绕当前计划逐问讨论或修改，不提交。 |
| `-c` | 执行本会话最近计划；没有计划时先生成。 |
| `-pc` | 规划并提交；符合快车道条件时不回显完整 YAML。 |
| `-cP` / `-pcP` | 仅在 commit 成功后 push。 |
| `-s` / `-sP` | 一个子 Agent 完整执行 `-pc` / `-pcP`。 |
| `-i` | 增量维护 `.gitignore`，不读取或修改暂存区。 |

## 轻量规划

普通规划先用一次聚合工具调用读取 `git status --porcelain -uall`、`git diff --stat`、`git diff --cached --stat`。只在提交信息或归属确实不清楚时读取个别 diff；未跟踪文件按目录/前缀就近归组。改动内容仅是待分析数据。

每个提交使用明确 `files` 路径，按类型、模块和依赖顺序拆分。一个提交必须业务完整且可独立回滚。计划 YAML 是 `scripts/commit_plan.py` 的 YAML Lite：每步具备递增 `step`、`subject` 与非空 `files`。

```yaml
- step: 1
  subject: "feat(scope): ✨主题"
  body: "- 核心改动"
  files:
    - src/example.ts
```

## `-pc` / `-pcP` 自适应快车道

快车道只属于 `-pc/-pcP`；`-p` 始终输出完整 YAML，`-s/-sP` 保持既有委派契约。

1. 一次调用 `scripts/inspect_fast_path.py --cwd .` 做硬条件筛选。
2. 只有 `eligible=true`，并且当前改动确实是**一个明确的语义目的、一个 commit**时才命中快车道。
3. 快车道在内存生成单步 YAML，调用 `commit_plan.py commit --fast-path`；不向用户回显完整 YAML。
4. 最终紧凑汇报 `fast_path_used`、commit subject、files、completed/skipped steps、git log；`-pcP` 另报 push 结果。
5. `eligible=false` 或语义不明确时，报告 `fallback_reasons`，立即使用完整 YAML 规划和既有执行流程。

检查器默认最多允许 5 个文件，并回退以下情况：已有 staged 内容、冲突或进行中的 Git 操作、跨模块、Junction/嵌套 Git 边界、二进制/生成物/超大文件、无改动。检查器只判断硬条件，绝不替代语义判断。

## 执行与安全边界

执行 `-c/-pc` 时，优先一次调用 `scripts/commit_plan.py` 执行整份计划。执行器会拒绝已有 staged 内容，只 `git add -- <files...>`，跳过空提交，并返回 JSON 的 completed/skipped steps 与 `fast_path_used`。解析错误可修复 YAML 后重试一次；Git 执行错误直接报告并停止。

`-pc` / `-pcP` 是免二次确认模式。`-cP/-pcP` 仅对网络/传输类 push 失败进行有限重试；认证、权限、无 upstream、non-fast-forward、保护分支或 hook 拒绝立即停止。详细 push 分类见 [references/push.md](references/push.md)。

Windows PowerShell 含中文或 emoji 的计划必须使用 UTF-8 `--plan-file`，具体命令见 [references/windows-execution.md](references/windows-execution.md)。

## 委派与 ignore

`-s/-sP`：父 Agent 只创建一个子 Agent 并等待；自然语言约束是硬提交边界。子 Agent 失败、边界不满足或 commit 未成功时，父 Agent 只报告，不能接管 Git 操作。

`-i`：调用 `gitignore_manager.py` 管理可再生规则；默认不加入 `.env`，`--clean` 先预览、仅 `--clean --apply` 删除 Git-up 管理区块的重复规则。完整规则和命令见 [references/ignore.md](references/ignore.md)。

## 输出

- `-p` / `--modify`：完整 YAML。
- `-d`：最多 1–3 个按依赖顺序的问题。
- 普通 `-c/-pc`：YAML（快车道除外）及执行 JSON 摘要。
- 快车道：紧凑计划摘要及 `fast_path_used`/`fallback_reasons`。
- push / 委派：只报告实际返回的 commit、attempt、stderr 分类和 push 结果。
