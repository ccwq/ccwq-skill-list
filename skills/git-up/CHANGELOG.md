# Changelog

All notable changes to this skill will be documented in this file.

## [2.0.0] - 2026-06-26

### 破坏性 / 重构（彻底简化：去掉持久化层与脚本层，全程会话内完成）
- **诊断纠偏**：实测一次 `-p` 仍 2m49s / 9.9k token——加载的正是 v1.4.0 slim 版 SKILL.md。证明瘦身省的是**输入**，而单次成本主体在脚本测不到的三处：① Agent **输出 token**（工件多重编码）② **串行工具往返**延迟 ③ Agent **过度探索**。旧 `run_eval.py` 用输入字节对比 131KB 全量 diff（v1.2.1 已解决）自我安慰，给出「减 93%」的虚假信心
- **去掉一切落盘工件**：删除 `plan.yaml` / `step-N.*` / `guard`。计划只存于对话上下文，`-p` 把 YAML 计划直接输出到会话，不写任何文件——消除「同一份 subject/body/files 被编码多次」的根源
- **去掉脚本层**：删除 `scripts/commit.sh`、`scripts/stamp.sh`、`scripts/lib.sh` 及护栏机制。`-c` 改为**直接用 Bash 执行** `git add` + `git commit -F -`（heredoc 传多行 message）
- **`-c` 单次往返执行（性能关键）**：整份计划拼成**一个 Bash 调用**一次性跑完（含 `git log`），不逐 step 分多次调用。实测 6 步 `git add+commit` 实际工作仅 23ms，墙钟全在工具往返（每轮数秒模型推理）——逐 step 调用会把 1 次往返放大成 N+ 次（这正是旧脚本 `sh commit.sh` 单进程循环的隐性优势，简化后必须显式保留）。安全性由「只 add 计划内显式路径」结构性保证，无需单独的 `git status` 预检往返
- **删除脚本测试**：移除 `test-space/git-up-commit-sh-tests/` 与 `test-space/git-up-eval/`（所测脚本层已不存在）
- **权衡**：放弃跨会话续跑与哈希护栏过期检测，换取零工件、零脚本、零依赖的极简模型；`-p` 与 `-c` 须在同一会话内完成
- **保留**：模式集（plan/discuss/modify/commit/-pc/default）、轻量规划输入、Commit Message 类型表、拆分规则、空提交防护、fail-fast

## [1.4.0] - 2026-06-26

### 性能（真正解决 `--plan` 慢：4min/10k token → 大幅下降）
- **SKILL.md 激进瘦身**：405 行 / 20KB → 118 行 / 6.6KB（~12k → ~3.9k token，减 67%）。删除重复示例、重叠的执行序列、遗留 `{diff}` 占位「初始化指令」与冗余 rationale。SKILL.md 每次触发全量载入，这是单次调用 token 的大头
- **规划输入改轻量**：plan 阶段改用 `git status --porcelain -uall` + `git diff --stat` 获取文件清单与改动规模，**不再一次性读全量 `git diff`**；仅在需要细化某条 message 时才读个别文件的 diff
- **未跟踪文件关联改轻量启发式**：按目录/文件名就近归组，不再逐个打开未跟踪文件在 diff 里搜路径引用（旧做法是开放式读文件的时间黑洞）
- 诊断结论：`--plan` 的 4min/10k 成本在 SKILL.md 载入 + 串行工具往返 + 开放式扫描，**与脚本无关**（脚本层已是毫秒级）

## [1.3.0] - 2026-06-26

### 重构 / 简化（仍为零依赖 POSIX sh，未引入 python）
- **过期检测换护栏**：用全 diff 快照（`staged.diff`/`worktree.diff`/`status.txt` + 全套 CRLF 规范化）替换为轻量 `guard` 两值护栏 —— `HEAD sha` + 工作区树哈希（临时索引 `read-tree HEAD` + `add -A` + `write-tree`）。git 原生、零落地、无 CRLF 规范化，且**内容敏感**：能检测未跟踪文件的内容编辑与增删（旧快照与早期 diff-hash 方案均会漏检）
- **扁平单计划布局**：去掉 `current` 指针、随机 4 位 id 与 `<id>/` 子目录，工件直接落在 `$(git rev-parse --git-path git-up)/` 下；一仓一活动计划，`--plan` 直接覆写
- `scripts/snapshot.sh` → `scripts/stamp.sh`（盖章 `guard`）；`scripts/lib.sh` 改为护栏助手 `compute_guard`/`write_guard`/`assert_guard`；`commit.sh` 适配扁平布局与护栏
- 移除 `manifest.env`
- 决策背景：调查确认 `--plan` 慢的真凶是 Agent 复述大 diff（1.2.1 已修），而 python 重构唯一增量收益（消灭 step-N.* 重复）最小却要丢掉 Windows git bash 零依赖，故保留 sh，只做语言无关的简化

## [1.2.1] - 2026-06-25

### 新增
- 新增 `--plan --commit` / `-pc` 一步模式：规划、落盘工件并立即执行提交，跳过 discuss/modify 复核，适用于信任拆分、无需中途确认的场景

### 性能 / 修复
- Plan / Modify / Discuss 阶段不再由 Agent 逐字复述 diff/status 写快照，改为执行 `scripts/snapshot.sh` 用 git 重定向生成 `staged.diff` / `worktree.diff` / `status.txt`，消除大 diff 复述带来的耗时主体
- 快照改由脚本生成后，与 `--commit` 阶段比对必然字节一致，修掉手工复述快照易与 git 输出不一致而误判 stale 的隐患
- 新增 `scripts/lib.sh`：抽取 `normalize_snapshot` / `write_snapshot`，供 `commit.sh` 与 `snapshot.sh` 共用，避免规范化规则漂移
- 新增 `scripts/snapshot.sh`：纯 POSIX、零依赖，定位 active 计划目录后落盘三份规范化快照

## [1.2.0] - 2026-06-25

### 变更
- 修复 `step-N.files` 末行无换行时最后一个文件不会进入 `git add` 的问题
- 修复 Windows/PowerShell 文本写入导致快照 CRLF/LF 差异或空 diff 被写成 CRLF 空行时的误判
- 新增参数缩写：`--plan` 可用 `-p`，`--commit` 可用 `-c`
- `--plan` 阶段立即持久化 `plan.yaml`、快照文件与编译后的 `step-N.msg/files`
- `--discuss` / `--modify` 在可见计划变化时同步更新磁盘计划工件
- `--commit` 改为只校验并执行已落盘计划，工件缺失或过期时拒绝执行，不再重建计划
- 计划工件目录迁移到 `git rev-parse --git-path git-up` 下的 `current` + `<随机4位>/` 结构，避免仓库根 `tmp/` 与 `.gitignore` 污染

## [1.1.0] - 2026-06-25

### 变更
- `--commit` 模式改为「编译中间产物 + 调用内置脚本」方式，不再逐步调用工具
- 新增内置脚本 `scripts/commit.sh`：纯 POSIX sh、零依赖，逐 step 执行 git add + git commit
- 中间产物存于 `<repo-root>/tmp/git-up-<hash4>/`，按项目本地 + HEAD hash 双重隔离，支持多项目并行
- `step-N.msg` 存 message 原文（`git commit -F`）、`step-N.files` 存文件清单（逐行 add，含空格安全）
- fail-fast + 每步成功即删，支持断点续跑；空提交自动跳过；全部成功清空批次目录
- 自动向 `.gitignore` 追加 `/tmp/git-up-*/`（去重）
- 兼容 Windows git bash 执行

## [1.0.0] - 2026-04-08

### 新增
- 支持多模式提交：plan、discuss、modify、commit
- 合并了原有的 git-commit 和 gitcommit 功能
- 支持 YAML 格式的提交计划输出
- 支持与用户讨论和修改提交计划
- 支持直接执行 git commit

### 初始版本
- 从 git-commit 和 gitcommit 合并而来
