# 跨平台与脚本参考

本文件仅在需要生成实际诊断脚本时读取。不要每轮机械加载全部内容。

## 1. 剪切板能力

### Windows

优先：

1. PowerShell `Set-Clipboard`
2. `clip.exe`

SSH 到 Windows、后台服务或非交互会话中，不得假定桌面剪切板可访问。

### macOS

优先 `pbcopy`，通过标准输入传值，不要把完整结果放到命令行参数。

### Linux Wayland

检测：

```bash
command -v wl-copy
```

### Linux X11

依次检测：

```bash
command -v xclip
command -v xsel
```

不得自动安装缺失工具。

### WSL

可尝试 `clip.exe`；失败后降级为控制台 + 系统临时文件。

### SSH / 容器 / CI

无图形会话时不要假定剪切板存在；已有能力失败后直接降级。

## 2. 临时文件规则

Linux/macOS 优先 `$TMPDIR`、`/tmp`、`mktemp`；权限尽量 `600`。

Windows 使用 `[System.IO.Path]::GetTempPath()` 和随机文件名。

规则：

- 随机命名。
- 不覆盖已有文件。
- 只保存脱敏后的结果。
- 显示绝对路径。
- 提供删除命令。
- 不在用户回传前自动删除。

## 3. 脱敏重点

重点识别以下键名或头部：

- password / passwd / pwd
- token / access_token / refresh_token
- secret / client_secret
- api_key / apikey
- authorization / bearer
- cookie / set-cookie
- access_key / secret_key
- private key

同时考虑 JSON、YAML、INI、Shell、环境变量、URL、Header 等格式。

环境变量采集优先白名单，不要默认执行并回传完整 `env` / `printenv` / `set` / `Get-ChildItem Env:`。

读取配置文件时优先提取相关键；敏感值只报告“存在/缺失”、长度或指纹。

## 4. Python 参考骨架

```python
from __future__ import annotations

import os
import platform
import re
import secrets
import subprocess
import tempfile
from pathlib import Path


def run_collection() -> tuple[str, int]:
    completed = subprocess.run(
        ["COMMAND", "ARGUMENT"],
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )
    combined = (
        "$ COMMAND ARGUMENT\n"
        f"[exit_code={completed.returncode}]\n"
        f"{completed.stdout}\n{completed.stderr}"
    )
    return combined, completed.returncode


def redact(text: str) -> str:
    rules = [
        (
            re.compile(
                r"(?i)(password|passwd|pwd|token|secret|api[_-]?key)"
                r"(\s*[:=]\s*)([^\s,;]+)"
            ),
            r"\1\2<REDACTED:CREDENTIAL>",
        ),
        (
            re.compile(r"(?i)(authorization\s*:\s*bearer\s+)\S+"),
            r"\1<REDACTED:CREDENTIAL>",
        ),
    ]
    result = text
    for pattern, replacement in rules:
        result = pattern.sub(replacement, result)
    return result


def copy_to_clipboard(text: str) -> bool:
    system = platform.system().lower()
    if system == "darwin":
        candidates = [["pbcopy"]]
    elif system == "windows":
        candidates = [["clip.exe"]]
    else:
        candidates = [
            ["wl-copy"],
            ["xclip", "-selection", "clipboard"],
            ["xsel", "--clipboard", "--input"],
        ]

    for command in candidates:
        try:
            completed = subprocess.run(
                command,
                input=text,
                text=True,
                capture_output=True,
                check=False,
                timeout=10,
            )
            if completed.returncode == 0:
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return False


def write_fallback(text: str) -> Path:
    path = Path(tempfile.gettempdir()) / f"agent-diag-{secrets.token_hex(6)}.txt"
    path.write_text(text, encoding="utf-8")
    if os.name != "nt":
        path.chmod(0o600)
    return path


def main() -> int:
    raw, rc = run_collection()
    sanitized = redact(raw)

    if copy_to_clipboard(sanitized):
        print("结果已脱敏并复制到剪切板，请直接粘贴回复。")
        return 0 if rc == 0 else 10

    path = write_fallback(sanitized)
    print(sanitized)
    print("\n剪切板不可用，脱敏结果同时保存到：")
    print(path)
    print("请复制上方结果，或读取该文件后粘贴回复。")
    return 20 if rc == 0 else 30


if __name__ == "__main__":
    raise SystemExit(main())
```

生成实际脚本时替换命令、增加当前场景专项脱敏规则，并避免保存未脱敏原文。

## 5. Node.js 参考骨架

```javascript
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function collect() {
  const result = spawnSync("COMMAND", ["ARGUMENT"], {
    encoding: "utf8",
    shell: false,
    timeout: 30000,
  });

  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  return {
    exitCode,
    output: [
      "$ COMMAND ARGUMENT",
      `[exit_code=${exitCode}]`,
      result.stdout || "",
      result.stderr || "",
      result.error ? String(result.error.message || result.error) : "",
    ].join("\n"),
  };
}

function redact(text) {
  return text
    .replace(
      /(password|passwd|pwd|token|secret|api[_-]?key)(\s*[:=]\s*)([^\s,;]+)/gi,
      "$1$2<REDACTED:CREDENTIAL>",
    )
    .replace(
      /(authorization\s*:\s*bearer\s+)\S+/gi,
      "$1<REDACTED:CREDENTIAL>",
    );
}

function tryClipboard(text) {
  const candidates =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
        ? [["clip.exe", []]]
        : [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
          ];

  for (const [command, args] of candidates) {
    const result = spawnSync(command, args, {
      input: text,
      encoding: "utf8",
      shell: false,
      timeout: 10000,
    });
    if (!result.error && result.status === 0) return true;
  }
  return false;
}

function writeFallback(text) {
  const filename = `agent-diag-${crypto.randomBytes(6).toString("hex")}.txt`;
  const filePath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(filePath, text, { encoding: "utf8", mode: 0o600 });
  return filePath;
}

const { output, exitCode } = collect();
const sanitized = redact(output);

if (tryClipboard(sanitized)) {
  console.log("结果已脱敏并复制到剪切板，请直接粘贴回复。");
  process.exit(exitCode === 0 ? 0 : 10);
}

const filePath = writeFallback(sanitized);
console.log(sanitized);
console.log("\n剪切板不可用，脱敏结果同时保存到：");
console.log(filePath);
console.log("请复制上方结果，或读取该文件后粘贴回复。");
process.exit(exitCode === 0 ? 20 : 30);
```

禁止使用 `shell: true` 拼接未经验证的用户输入。

## 6. PowerShell 参考骨架

```powershell
$ErrorActionPreference = "Stop"

function Protect-DiagnosticText {
    param([Parameter(Mandatory)][string]$Text)

    $result = $Text
    $result = [regex]::Replace(
        $result,
        '(?i)(password|passwd|pwd|token|secret|api[_-]?key)(\s*[:=]\s*)([^\s,;]+)',
        '$1$2<REDACTED:CREDENTIAL>'
    )
    $result = [regex]::Replace(
        $result,
        '(?i)(authorization\s*:\s*bearer\s+)\S+',
        '$1<REDACTED:CREDENTIAL>'
    )
    return $result
}

function Set-DiagnosticClipboard {
    param([Parameter(Mandatory)][string]$Text)

    try {
        if (Get-Command Set-Clipboard -ErrorAction SilentlyContinue) {
            Set-Clipboard -Value $Text
            return $true
        }
        if (Get-Command clip.exe -ErrorAction SilentlyContinue) {
            $Text | clip.exe
            return ($LASTEXITCODE -eq 0)
        }
    } catch {
        return $false
    }
    return $false
}

# 替换为当前任务只读命令，并在内存中捕获结果。
$output = & COMMAND ARGUMENT 2>&1 | Out-String
$rc = $LASTEXITCODE
$raw = "`$ COMMAND ARGUMENT`n[exit_code=$rc]`n$output"
$safe = Protect-DiagnosticText -Text $raw

if (Set-DiagnosticClipboard -Text $safe) {
    Write-Host "结果已脱敏并复制到剪切板，请直接粘贴回复。"
    if ($rc -eq 0) { exit 0 } else { exit 10 }
}

$tempDir = [System.IO.Path]::GetTempPath()
$name = "agent-diag-$([guid]::NewGuid().ToString('N')).txt"
$path = Join-Path $tempDir $name
[System.IO.File]::WriteAllText($path, $safe, [System.Text.UTF8Encoding]::new($false))

Write-Host $safe
Write-Host ""
Write-Host "剪切板不可用，脱敏结果同时保存到："
Write-Host $path
Write-Host "请复制上方结果，或读取该文件后粘贴回复。"
if ($rc -eq 0) { exit 20 } else { exit 30 }
```

避免 `Invoke-Expression`。

## 7. Bash 参考骨架

```bash
#!/usr/bin/env bash
set -u
set -o pipefail

collect() {
  local output rc
  output="$(
    {
      printf '%s\n' '$ COMMAND ARGUMENT'
      COMMAND ARGUMENT
    } 2>&1
  )"
  rc=$?
  printf '[exit_code=%s]\n%s\n' "$rc" "$output"
  return "$rc"
}

redact() {
  sed -E \
    -e 's/((password|passwd|pwd|token|secret|api[_-]?key)[[:space:]]*[:=][[:space:]]*)[^[:space:],;]+/\1<REDACTED:CREDENTIAL>/Ig' \
    -e 's/(authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+)[^[:space:]]+/\1<REDACTED:CREDENTIAL>/Ig'
}

copy_clipboard() {
  local text="$1"
  if command -v pbcopy >/dev/null 2>&1; then printf '%s' "$text" | pbcopy; return $?; fi
  if command -v wl-copy >/dev/null 2>&1; then printf '%s' "$text" | wl-copy; return $?; fi
  if command -v xclip >/dev/null 2>&1; then printf '%s' "$text" | xclip -selection clipboard; return $?; fi
  if command -v xsel >/dev/null 2>&1; then printf '%s' "$text" | xsel --clipboard --input; return $?; fi
  if command -v clip.exe >/dev/null 2>&1; then printf '%s' "$text" | clip.exe; return $?; fi
  return 1
}

raw="$(collect)"
rc=$?
safe="$(printf '%s' "$raw" | redact)"

if copy_clipboard "$safe"; then
  printf '%s\n' '结果已脱敏并复制到剪切板，请直接粘贴回复。'
  [ "$rc" -eq 0 ] && exit 0 || exit 10
fi

tmp_file="$(mktemp "${TMPDIR:-/tmp}/agent-diag.XXXXXXXX.txt")" || exit 40
chmod 600 "$tmp_file" 2>/dev/null || true
printf '%s\n' "$safe" >"$tmp_file"

printf '%s\n' "$safe"
printf '\n剪切板不可用，脱敏结果同时保存到：\n%s\n' "$tmp_file"
printf '%s\n' '请复制上方结果，或读取该文件后粘贴回复。'
printf '清理命令：rm -f -- %q\n' "$tmp_file"
[ "$rc" -eq 0 ] && exit 20 || exit 30
```

避免 `eval`、未引用变量、`curl | sh`、自动 `sudo`，以及在脱敏前 `tee` 原始输出。

## 8. CMD 注意事项

CMD 的可靠文本处理和脱敏能力有限。

用户指定 CMD 时可以使用；简单采集可由 CMD 完成。复杂脱敏优先让 CMD 调用系统已有 PowerShell 进行内存处理和剪切板写入。

如果用户明确禁止 PowerShell，应说明 CMD 脱敏局限并缩小采集范围，而不是把未脱敏结果落盘。

## 9. 每次生成实际脚本前的自检

- 是否只读，或已获得对应修改授权？
- 是否只提供一个主要脚本？
- 是否符合用户指定语言？
- 是否在脱敏前打印/落盘原始输出？
- 是否可能把凭证暴露到命令行参数、进程列表或 Shell 历史？
- 是否自动安装依赖或提权？
- 是否覆盖已有文件？
- 剪切板成功时是否只打印成功提示？
- 剪切板失败时控制台与临时文件是否内容一致？
- 是否提供临时文件清理方式？
- 是否把剪切板失败和采集失败区分开？
