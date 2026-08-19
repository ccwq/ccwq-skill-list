# Windows 适配器

仅当相关 endpoint/gateway 运行在 Windows 上时使用。

优先明确调用 `curl.exe`。

CMD 用户可以这样调用 PowerShell collector：

```cmd
powershell.exe -NoProfile -NonInteractive -Command "..."
```

如果需要隐藏输入私密信息，省略 `-NonInteractive`。

## 剪贴板优先

用户执行的 collector 优先将脱敏结果直接复制到剪贴板：

```powershell
$out -join [Environment]::NewLine | Set-Clipboard
Write-Host '诊断结果已复制到剪贴板，请直接回来粘贴。'
```

剪贴板不可用时，打印已经脱敏的结果，并可选地保存到随机 `%TEMP%` 文件。

## PowerShell 可靠性

避免 `%`、`?`、`gp`、`cat`、含义不明确的 `curl` 和 Bash `%%`。使用完整 cmdlet，并使用 `Get-DiagProxy` 这类自定义名称。

Windows PowerShell 5.1 读取 UTF-8 vendor JSON 时，使用 `curl.exe` 写入文件，然后：

```powershell
[IO.File]::ReadAllText($path,[Text.Encoding]::UTF8)
```

## 只读命令

```powershell
Get-NetAdapter
Get-NetIPConfiguration
Get-NetIPInterface
Get-DnsClientServerAddress
Resolve-DnsName <host>
Get-NetRoute
Find-NetRoute -RemoteIPAddress <ip>
Test-NetConnection <host> -Port <port>
Get-NetTCPConnection
Get-NetUDPEndpoint
Get-NetFirewallProfile
```

```cmd
netsh winhttp show proxy
netsh interface ipv4 show subinterfaces
netsh interface ipv6 show subinterfaces
```

选择与当前问题最相关的最小子集。

如果 curl 使用 Schannel，遵循 `tls-http.md`；不要假设每个 Schannel error 都是 Windows TLS 根因。
