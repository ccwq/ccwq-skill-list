# 环境识别与执行适配

本参考仅在环境未知、发生变化，或需要生成跨环境命令时读取。它定义事实模型，不要求用户一次提交完整机器指纹。

## Environment Profile

每次 probe 都基于下列最小 profile；未知值应写 `unknown`，不能靠平台刻板印象补全：

```text
os: windows | linux | macos | unknown
shell: powershell | cmd | bash | zsh | sh | unknown
location: local | ssh | wsl | container | ci | remote-desktop | unknown
interactive: true | false | unknown
privilege: standard | elevated | root | restricted | unknown
clipboard: available | unavailable | unknown
runtimes: [node, python, ...]
tools: [git, curl, ...]
network: online | proxied | restricted | offline | unknown
```

`location` 可组合，例如 SSH 进入 Linux 容器时优先记录最接近被测对象的 `container`，并在 `facts` 标明其 SSH 外层。不要收集用户名、主机名或完整路径作为识别前提。

## Bootstrap probe

选择当前 Shell 能运行的一个 adapter。优先直接采集本 Shell 的事实；只有 CMD 无法安全承载结构化处理时才通过 `powershell.exe -NoProfile -NonInteractive` 调用 PowerShell。每个 bootstrap probe 必须：

1. 只读收集 OS、Shell、位置线索、权限、工作目录、可用运行时、关键工具与剪切板能力；
2. 为每个子命令记录成功/失败，而不是因一个缺失命令中止；
3. 生成随机 `run_id`；
4. 先 sanitize 再按 `debug_report` 协议回传；
5. 不安装工具、不提权、不联网、不读取环境变量中的凭据。

如果环境已知，跳过 bootstrap，直接使用匹配 adapter 做业务 probe。

## Adapter 选择

| 已知条件 | 首选 adapter | 降级 | 注意事项 |
|---|---|---|---|
| Windows + PowerShell | PowerShell | CMD | 用 `-NoProfile`；`Set-Clipboard` 必须 try/catch |
| Windows + CMD | CMD | PowerShell（仅可用时） | 所有路径用引号；不假定管理员权限 |
| Linux/macOS + Bash/Zsh | 当前 POSIX Shell | Python（已存在时） | 不依赖 `sudo`；不要 `eval` 用户输入 |
| WSL | Bash | `clip.exe` 作为可选 clipboard | Windows 剪切板失败不是采集失败 |
| SSH/容器/CI | 当前远端 Shell | 终端输出 | 默认 `clipboard=unavailable`，除非能力探测成功 |
| 项目明确 Node 且 Node 已可用 | Node.js | 当前 Shell | 仅在 Node 能降低复杂度时选用 |

不要把“OS 是 Windows”推导为“拥有 GUI、PowerShell 7 或管理员权限”；不要把“Linux”推导为 Bash、`systemctl`、`sudo` 或剪切板工具存在。

## 重新识别触发条件

下列变化会使先前 profile 失效：用户切换终端、SSH 主机/容器、WSL 与 Windows 边界、权限身份、CI runner，或问题目标移动到另一台机器。重识别时复用仍可信字段，只补充变化维度。
