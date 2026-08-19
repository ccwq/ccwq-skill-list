# Windows Adapter

Use only when a relevant endpoint/gateway runs Windows.

Prefer `curl.exe` explicitly.

For CMD users, PowerShell collectors may be invoked with:

```cmd
powershell.exe -NoProfile -NonInteractive -Command "..."
```

If hidden local secret input is needed, omit `-NonInteractive`.

## Clipboard-first

For user-run collectors, prefer sanitized output directly to clipboard:

```powershell
$out -join [Environment]::NewLine | Set-Clipboard
Write-Host '诊断结果已复制到剪贴板，请直接回来粘贴。'
```

If clipboard access fails, print the already-redacted result and optionally save a random `%TEMP%` file.

## PowerShell reliability

Avoid `%`, `?`, `gp`, `cat`, ambiguous `curl`, and Bash `%%`. Use full cmdlets and custom names such as `Get-DiagProxy`.

For UTF-8 vendor JSON under Windows PowerShell 5.1, write with `curl.exe`, then read with:

```powershell
[IO.File]::ReadAllText($path,[Text.Encoding]::UTF8)
```

## Read-only primitives

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

Choose the smallest relevant subset.

If curl uses Schannel, follow `tls-http.md`; do not assume every Schannel error is a Windows TLS root cause.
