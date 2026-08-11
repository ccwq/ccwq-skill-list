# Codex Windows Hooks Fix

诊断并修复 Windows 上 Codex hooks 的入口命令、PowerShell 包装器与 stdout JSON schema 问题。目标是让真实 Codex hook runner 接受命令、退出码和输出，而不只是让单个脚本看起来可以运行。

## 适用症状

- `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse` 或 `Stop hook failed`。
- `hook exited with code 1`、`invalid JSON output`、`invalid pre-tool-use JSON output`。
- `hooks.json` 使用裸 `sh`、`python3`、`.sh`，或依赖 Git Bash、WSL、PATH 展开。
- `PreToolUse` 输出了不兼容的 `decision=allow`。

## 快速开始

```text
$codex-windows-hooks-fix Windows 上 PreToolUse hook 报 invalid pre-tool-use JSON output，帮我修
$codex-windows-hooks-fix Codex 启动时报 SessionStart hook failed，hooks.json 里使用了 sh 和 python3
```

本 Skill 没有显式参数。它先读取真实 `hooks.json` 与脚本，再做最小改动；完整调用约定见根 [README](../../README.md)。

## 推荐结构

Windows 下以一个稳定的 PowerShell 入口承接事件，再把复杂逻辑下沉到事件脚本：

```text
hooks.json
  -> powershell.exe ... hooks/run-hook.ps1
hooks/run-hook.ps1
  -> 解析 CODEX_HOME 或当前用户 .codex
  -> 调用 hooks/<hook-name>.ps1
hooks/<hook-name>.ps1
  -> 执行具体逻辑；默认允许路径静默 exit 0
```

路径应由 PowerShell 在运行时解析，避免把用户名、盘符或外层 shell 变量展开写死到配置中。

## 输出契约

默认允许路径使用空 stdout 和退出码 `0`。当确实需要注入上下文时，只输出 Codex 可接受的 JSON，例如 `{"systemMessage":"..."}`；不要在 JSON 外输出日志、调试文本或 Claude Code 风格的 `{"decision":"allow"}`。

异常应以可解析的 `systemMessage` 或静默方式降级，避免阻断用户主流程。

## 验证

修复后依次完成：

```powershell
Test-Json -Path <codex-home>/hooks.json
# 再直接执行每个 hooks.json 中注册的命令
codex exec --dangerously-bypass-hook-trust --dangerously-bypass-approvals-and-sandbox -C <test-dir> "只运行一个 PowerShell 命令后结束"
```

真实 `codex exec` 是最终验证：它应显示 hook 完成，而不再显示 `invalid pre-tool-use JSON output`。完整命令、双分支 smoke 和验收清单见 [SKILL.md](SKILL.md)。
