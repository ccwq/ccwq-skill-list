# Changelog

All notable changes to this skill will be documented in this file.

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
