---
name: codex-windows-hooks-fix
version: 1.0.0
description: 修复 Windows 环境中的 Codex hooks 语法、入口命令和 stdout JSON schema 问题。用户提到 Codex hooks 在 Windows 报 SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop hook failed、invalid JSON output、invalid pre-tool-use JSON output、decision=allow、裸 sh/python3/.sh、PowerShell hook 包装器、hooks.json 路径展开失败或需要验证 hook 链路时必须使用。
---

# Codex Windows Hooks Fix

用于在 Windows 上诊断和修复 Codex hooks 失败。重点不是单独让脚本能跑，而是让 Codex 真实 hook runner 能接受入口命令、退出码和 stdout schema。

## 适用场景

- `SessionStart hook (failed)`、`UserPromptSubmit hook (failed)`、`Stop hook (failed)`、`PreToolUse hook (failed)`。
- `error: hook exited with code 1`。
- `hook returned invalid ... JSON output` 或 `invalid pre-tool-use JSON output`。
- Windows 下 hook 配置里用了裸 `sh`、裸 `python3`、`.sh`、Git Bash/WSL/PATH 依赖链。
- 修完 hook 后需要证明 `codex exec` 子进程能真实触发并通过 hook。

## 先调查

先读取当前用户的真实配置，不要凭记忆改：

```powershell
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
Get-Content -Raw -LiteralPath (Join-Path $codexHome 'hooks.json')
Get-ChildItem -Recurse -LiteralPath (Join-Path $codexHome 'hooks') | Select-Object FullName,Length
```

同时确认：

- `hooks.json` 是否能被 `Test-Json` 解析。
- 注册命令是否依赖 `%USERPROFILE%`、`$env:USERPROFILE` 外层插值、盘符绝对路径、裸 `sh`、裸 `python3` 或 `.sh`。
- 具体 hook 脚本是否在默认允许路径输出了无意义 JSON 或普通日志。
- `PreToolUse` 是否输出了 Claude Code 风格的 `{"decision":"allow"}`。

## 修复原则

1. Windows 下优先使用 `powershell.exe -NoProfile -ExecutionPolicy Bypass` 作为 hook 入口。
2. `hooks.json` 只保留稳定、短小的入口命令；复杂路径解析放进 `run-hook.ps1`。
3. 入口脚本用 `[Environment]::GetFolderPath('UserProfile')` 推导用户目录，避免依赖 `cmd.exe` 变量展开。
4. PWF 或其他检查逻辑优先调用 `.ps1`，避免 `python3 -> sh -> .sh` 的多层跨 shell 链。
5. hook 内部异常要降级为 `systemMessage` 或静默，最后 `exit 0`，不要阻断用户主流程。
6. 需要 JSON 的 hook 不能输出裸文本、日志或调试信息；无内容时空 stdout，有内容时只输出 Codex 接受的 JSON。
7. `PreToolUse` 默认允许工具执行时保持空 stdout + `exit 0`，不要输出 `{"decision":"allow"}`。
8. 不要把 Claude Code hook schema 直接搬到 Codex hook；同名事件不代表返回字段完全兼容。

## 推荐结构

```text
hooks.json
  -> powershell.exe ... -Command "调用当前用户 Codex 目录下的 hooks/run-hook.ps1"

hooks/run-hook.ps1
  -> 解析 CODEX_HOME；否则回退到当前用户 .codex
  -> 调用 hooks/<hook-name>.ps1

hooks/<hook-name>.ps1
  -> 做具体逻辑
  -> 默认允许路径静默 exit 0
  -> 需要注入上下文时输出 {"systemMessage":"..."}
```

`run-hook.ps1` 示例：

```powershell
param(
    [Parameter(Mandatory = $true)]
    [string]$Name
)

try {
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
    $hookPath = Join-Path (Join-Path $codexHome 'hooks') "$Name.ps1"
    if (Test-Path -LiteralPath $hookPath) {
        & $hookPath
    }
} catch {
    @{ systemMessage = "[codex hook:$Name] $($_.Exception.Message)" } | ConvertTo-Json -Compress
}

exit 0
```

`PreToolUse` 的默认允许分支示例：

```powershell
try {
    $planFile = Join-Path (Get-Location) 'task_plan.md'
    if (Test-Path -LiteralPath $planFile) {
        $planHead = (Get-Content -LiteralPath $planFile -TotalCount 30 | Out-String).Trim()
        if (-not [string]::IsNullOrWhiteSpace($planHead)) {
            @{ systemMessage = $planHead } | ConvertTo-Json -Compress
            exit 0
        }
    }
} catch {
    @{ systemMessage = "[planning-with-files hook] $($_.Exception.Message)" } | ConvertTo-Json -Compress
}

exit 0
```

禁止在 `PreToolUse` 默认允许路径输出：

```powershell
@{ decision = 'allow' } | ConvertTo-Json -Compress
```

## hooks.json 写法

优先让所有事件走同一个包装器，只改变 `-Name`：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"& (Join-Path (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex') 'hooks\\run-hook.ps1') -Name session-start\""
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"& (Join-Path (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex') 'hooks\\run-hook.ps1') -Name pre-tool-use\""
          }
        ]
      }
    ]
  }
}
```

保留现有事件和 matcher 结构，只替换不稳定的 command。不要为了重写方便丢掉用户已有 hook。

## 验证流程

先做静态和直接命令验证：

```powershell
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
Test-Json -Path (Join-Path $codexHome 'hooks.json')

$payload = '{"tool_name":"Bash","tool_input":{"command":"echo test"},"cwd":"E:\\project"}'
$payload | powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& (Join-Path (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex') 'hooks\run-hook.ps1') -Name pre-tool-use"
```

无 `task_plan.md` 时，`PreToolUse` 预期 stdout 为空、退出码为 `0`。

然后必须用真实 Codex 子进程验证，因为错误经常发生在 Codex 解析 hook stdout 的环节：

```powershell
codex exec --dangerously-bypass-hook-trust --dangerously-bypass-approvals-and-sandbox -C E:/project/sx_gfyg_web "只运行一个 PowerShell 命令输出字符串 hook-smoke-test，然后结束。"
```

预期看到：

```text
hook: PreToolUse
hook: PreToolUse Completed
hook-smoke-test
hook: Stop Completed
```

不应再出现：

```text
PreToolUse hook (failed)
error: hook returned invalid pre-tool-use JSON output
```

有 `task_plan.md` 的分支也要验证：

```powershell
$tmp = Join-Path $env:TEMP 'codex-hook-pretool-smoke'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Set-Content -LiteralPath (Join-Path $tmp 'task_plan.md') -Value '# 临时 hook 验证计划' -Encoding UTF8
codex exec --dangerously-bypass-hook-trust --dangerously-bypass-approvals-and-sandbox -C $tmp "只运行一个 PowerShell 命令输出字符串 hook-plan-smoke-test，然后结束。"
Remove-Item -LiteralPath $tmp -Recurse -Force
```

## 验收清单

- `hooks.json` 能被 `Test-Json` 解析。
- 注册命令可以在 PowerShell 直接执行，退出码为 `0`。
- 默认允许路径空 stdout，不输出无意义 JSON。
- 需要输出时只输出 Codex 接受的 JSON，例如 `{"systemMessage":"..."}`。
- `PreToolUse` 不输出 `decision=allow`。
- `codex exec` 覆盖无计划文件和有 `task_plan.md` 两个分支。
- 最终输出里有 `hook: PreToolUse Completed`，且没有 `invalid pre-tool-use JSON output`。

## 输出要求

修复完成后，用中文给用户报告：

- 修改了哪些文件和关键命令。
- 原因归类：入口命令问题、路径展开问题、stdout schema 问题或具体脚本异常。
- 验证结果，包含 `Test-Json`、直接 hook 命令、`codex exec` 的关键输出。
- 如果不能运行真实 `codex exec`，明确说明缺口，不要把脚本级验证说成完整验收。
