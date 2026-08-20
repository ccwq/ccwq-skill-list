# 跨平台执行与安全模式

本文件仅在需要生成实际 probe 时读取。它给出 adapter 选择与安全构造规则；实际命令仍须受当前环境、最小假设和 `probe-contract.md` 约束。

## Adapter 能力表

| 环境 | 首选 | 剪切板尝试顺序 | 临时文件 | 禁止假设 |
|---|---|---|---|---|
| Windows PowerShell | `powershell.exe -NoProfile -NonInteractive` 或现有 PowerShell | `Set-Clipboard`、`clip.exe` | `[IO.Path]::GetTempPath()` + 原子创建 | GUI、管理员、PowerShell 7 |
| Windows CMD | `cmd.exe`；复杂脱敏可调用现有 PowerShell | `clip.exe` | PowerShell 原子创建；否则仅终端 | PowerShell 一定存在 |
| Linux/macOS Bash/Zsh | 当前 Shell | `pbcopy`、`wl-copy`、`xclip`、`xsel` | `mktemp` + `chmod 600` | `sudo`、桌面或 clipboard 工具 |
| WSL | 当前 Bash | 先检测 `clip.exe`，再 POSIX 工具 | `mktemp` | Windows 剪切板可访问 |
| SSH/容器/CI | 当前远端 Shell | 默认跳过，探测到才尝试 | `mktemp` 或 runner 临时目录 | 有 GUI/交互会话 |
| Node/Python | 仅在该运行时已存在且能降低复杂度时 | 子进程 stdin 传递文本 | 安全排他创建 | 可自动安装依赖 |

所有 adapter 都必须输出 `debug-report-protocol.md` 的 `SUMMARY / EVIDENCE / NEXT` 和 `RESULT_READY`，不能沿用自由文本成功提示。

## 采集、报告与退出语义

1. 每条待执行命令单独捕获 stdout、stderr、退出码、超时或缺失工具状态；一个子命令失败不能阻断其余独立采集。
2. 汇总原始结果仅保留在进程内存/受控管道，按 `sanitization.md` 处理后才可建立 `debug_report`。
3. 若任一必要采集失败但仍有证据，`collection_status=partial`；不能构成可信报告才是 `fatal`。
4. 剪切板只接收已脱敏完整报告。成功时输出 `RESULT_READY run_id=<id> clipboard=ok`；失败时输出同一报告和 `clipboard=unavailable`。
5. 脱敏规则异常或疑似敏感内容残留时，设 `redaction_status=review` 或 `failed`、`clipboard=skipped_for_review`；禁止自动写剪切板。

剪切板失败只影响交付路径，不得改变采集状态，也不得被误报为被测对象故障。

## 剪切板构造

- 必须通过标准输入传递报告，不能把报告拼进命令行参数、进程参数或 shell 历史。
- PowerShell 使用 `try/catch` 包裹 `Set-Clipboard` 与 `clip.exe` 调用；失败后继续终端回退。
- Bash/Zsh 依次以 `command -v` 检测 `pbcopy`、`wl-copy`、`xclip`、`xsel`、`clip.exe`；一个工具失败后继续尝试，最终失败不可中断报告输出。
- Node/Python 子进程必须关闭 shell 拼接（Node `shell: false`；Python 使用 argv 数组），并使用超时。
- 不得读取、备份、清空或覆盖执行前剪切板。

## 随机且不可覆盖的临时文件

临时文件只是剪切板失败或人工审阅时的可选降级，并且只允许写入**已经脱敏**的完整报告。

| Adapter | 合规构造 |
|---|---|
| Bash/Zsh | `mktemp "${TMPDIR:-/tmp}/agent-human-debug.XXXXXXXX.txt"`；写前确认成功，随后 `chmod 600`（尽力） |
| Python | `tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False, prefix="agent-human-debug-", suffix=".txt")`；创建后写入并关闭 |
| Node.js | `fs.openSync(path.join(os.tmpdir(), randomName), "wx", 0o600)`；仅成功获得 fd 后写入并关闭 |
| PowerShell | `[IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)`；冲突则生成新随机名重试有限次数 |

创建失败时不得回退到固定文件名或覆盖写入；应保留终端中已脱敏报告，并将 `collection_status` 或交付异常写入 `EVIDENCE`。文件创建后显示绝对路径与对应清理命令，但不在用户回传前自动删除。

## PowerShell 采集模式

不要以全局 `$ErrorActionPreference = 'Stop'` 包住整段 probe，否则单个查询异常会阻止报告生成。应在单个命令周围使用 `try/catch`，分别记录：

```text
- tool=<name> status=unavailable
- command=<name> status=failed exit_code=<n>
- command=<name> status=timeout
```

只有报告自身的构建失败才可标为 `collection_status=fatal`。不得使用 `Invoke-Expression`，不得把用户输入拼成可执行 PowerShell。

## CMD 约束

CMD 的结构化脱敏能力有限。用户明确指定 CMD 时，优先收窄为无凭据白名单采集；若现有 PowerShell 可用，可由 CMD 调用它进行内存中的结构化报告和安全回退。用户禁止 PowerShell 时，不得把未经可靠脱敏的内容写入文件或剪切板。

## 每次生成脚本前自检

- 环境 profile 是否仍适用，且只选了一个合适 adapter？
- 当前命令是否只验证一个高价值假设，并设置了日志/请求/目录等采集上限？
- 每个独立子命令是否捕获了状态，而非遇错中止？
- 是否在任何输出、剪切板和临时文件之前完成脱敏？
- 是否生成 `SUMMARY`、`EVIDENCE`、`NEXT` 和 `RESULT_READY`？
- clipboard 失败和脱敏失败是否分别降级，且不妨碍报告？
- 临时文件是否以排他方式创建、仅含脱敏内容、且提供清理命令？
- 是否避免自动安装、提权、`eval`/`Invoke-Expression`、`shell: true`、未引用变量和 `curl | sh`？
