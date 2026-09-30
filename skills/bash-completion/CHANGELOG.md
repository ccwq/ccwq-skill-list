# Changelog

All notable changes to this skill will be documented in this file.

## [1.0.0] - 2026-09-30

### Added / 新增
- 初始版本：从 `rd-tencent` 仓库 `.agents/skills/bash-completion` 原样纳入。
- 沉淀 Bash 补全的分能力流程：普通 Tab 候选、fzf 模糊选择与快捷键、ble.sh 实时建议/高亮、zoxide 跳转，以及启动顺序与冲突排查。
- 附带 POSIX sh 静态探针 `scripts/probe-bash.sh` 与实验性 PTY 验证器 `scripts/verify-pty.py`，以及能力模型、环境交接、项目适配、安装回滚、分层验证、隔离安装回归、精简 Linux 共 7 篇参考。
