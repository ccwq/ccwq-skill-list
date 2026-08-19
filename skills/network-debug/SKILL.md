---
name: network-debug
disable-model-invocation: true
description: 诊断桌面、服务器、路由器、NAS、虚拟机、容器、移动设备、代理、VPN 与 overlay 网络中的连通性和路径故障。用于 DNS 失败、路由问题、TCP/UDP 丢包或超时、HTTP/HTTPS 与 TLS 错误、代理失败、MTU 问题、非对称路径、split tunneling，以及 VPN/overlay 连通性问题。根据实际平台和可用工具调整调查方式，优先采用证据驱动、最小侵入的排障方法，避免凭设备或厂商名称猜测。默认使用中文回复；命令、错误串、协议名、产品名、代码、配置键、文件路径和 URL 保留英文原文；用户明确指定其他语言时遵循用户要求。
compatibility: 跨平台。支持 Windows、Linux、macOS、BSD-like 系统、路由器/NAS appliance、容器/VM，以及只能执行应用层测试的环境。
metadata:
  version: "0.2.0"
---

# 网络诊断

## 目的

在提出修复方案前，先定位最早失败的层级和实际经过的网络路径。

本技能不绑定设备或厂商。平台、VPN、代理、路由器和应用命令只是同一诊断模型的适配器，不是模型本身。

支持桌面、服务器、路由器、NAS、VM、容器、移动设备、代理、VPN、overlay、双栈网络、split tunnel 和多宿主机。

## 核心模型

始终把路径理解为一串边界：

```text
应用
→ 名称解析
→ 接口 / 源地址
→ 路由 / 策略路由
→ 传输层（TCP / UDP / ICMP）
→ 可选的代理 / VPN / 隧道入口
→ 可选的策略 / peer / 出站选择
→ 远端传输路径
→ TLS / 安全协商
→ HTTP 或应用协议
→ 远端应用
```

并非每个环境都包含所有层级。

始终回答：

1. 预期路径是什么？
2. 实际使用了什么路径？
3. 哪一层最早有直接失败证据？
4. 是否存在多个相互独立的故障？

## 通用原则

1. **先看路径，再看产品。** 不要因为错误里出现 OS、proxy、VPN、DNS、router 或 TLS，就直接归咎于它。
2. **最早失败层优先。** 后面的错误可能只是前面网络失败的症状。
3. **使用受控对照。** 优先只改变一个变量：direct/proxy、隧道开关、目标 A/B、IPv4/IPv6、HTTP/HTTPS、hostname/address、小/大流量。
4. **证据有边界。** 本地 proxy 的 CONNECT 只证明入口接受；VPN 的“connected”只证明控制面状态；ping 失败不等于 TCP 失败。
5. **允许多个根因并存。** 在证据证明共享根因之前，保持不同故障链分开。
6. **先只读。** 先观察，再改配置。
7. **绕过是诊断变量，不是修复。** 禁用校验、防火墙、IPv6、吊销检查或策略不能在没有根因证据时成为永久方案。
8. **修复后重现原始失败。** 替代测试成功不够。

## 交互模型

用户正在执行诊断时，按短轮次推进：

```text
主线：第 n/总数轮 | 阶段
目标：
操作类型：只读 / 低风险变更 / 高风险变更
为什么做这个测试：
命令或操作：
预期返回：
```

不要询问日志中已经可见的事实。除非批量执行少量只读检查明显更高效，否则每轮只选择一个高信息量步骤。

如果平台支持自动采集结果，优先使用自动采集，避免用户手工复制大量片段。

## 平台适配

尽可能根据现有证据识别环境：

- OS/平台以及 shell/UI；
- 本地还是远程 endpoint；
- 用户是否控制一端或两端；
- 可用诊断工具；
- 流量是否经过 proxy、VPN、tunnel、VM、container、router 或 overlay。

随后只加载相关适配器：

- Windows：`references/platform-windows.md`
- Linux/BSD：`references/platform-linux.md`
- macOS：`references/platform-macos.md`
- 移动端/路由器/受限 UI：`references/platform-limited.md`
- Proxy/VPN/overlay：`references/proxy-vpn-overlay.md`
- TLS/HTTP：`references/tls-http.md`

通用诊断树始终优先。

## 分层诊断树

### L0：进程 / 服务 / 本地 endpoint

确认本地进程、服务、listener、接口或 gateway 状态。本地 listener 只证明本地可用。

### L1：名称解析

确定 resolver 路径、A/AAAA 结果、split DNS、VPN/overlay DNS，以及设备间差异。`nslookup`/`dig` 成功不代表应用使用同一 resolver 路径。

### L2：接口 / 源地址 / 路由

确定选择的源地址、出口接口、next hop、路由特异性、metric/policy、隧道覆盖和潜在非对称。检查到实际目标地址的路由，不要只检查 default route。

### L3：传输层

区分 TCP、UDP 和 ICMP。

- TCP timeout、refused、reset 和 success 含义不同；
- UDP 尽量使用理解协议的证据；
- ICMP 只是补充，可能被过滤。

### L4：Proxy / VPN / tunnel 入口

确定本地 proxy/tunnel 是否接受请求。CONNECT accepted、SOCKS granted、接口 up 或 overlay authenticated 都不能证明远端 data plane 成功。

### L5：策略 / peer / 出站选择

确定实际命中的 rule、policy、group、peer、gateway、endpoint 或 DIRECT 路径。必要时递归检查嵌套 selector。

在证明失败流量确实命中之前，不要修改 default/MATCH/fallback policy。

### L6：远端路径及路径特征

调查 endpoint reachability、NAT、非对称、relay/direct、拥塞、丢包、MTU/PMTU 和中间设备。

小流量成功但 TLS、大响应、上传或隧道流量卡住时，提高对 MTU 的怀疑。

### L7：TLS / 安全协商

只有在较低层路径已有充分证据后，才诊断 TLS。

区分：

- 没有 TLS 响应；
- 协议/cipher 协商；
- SNI；
- certificate chain；
- revocation；
- TLS interception。

错误中含有“TLS”不等于 TLS 是最早失败层。

### L8：HTTP / 应用协议

识别是谁生成了响应。

- 远端 403/404 通常证明网络路径已到达 HTTP-speaking service；
- 本地 proxy 返回 502 往往指向 proxy outbound；
- 远端 reverse proxy 返回 502 则是另一个边界。

## 受控对照矩阵

| 对照 | 主要区分 |
|---|---|
| direct vs proxy | proxy/tunnel 路径与基础路径 |
| tunnel on vs off | 隧道路由/策略 |
| target A vs B | 目标特有问题与路径范围问题 |
| IPv4 vs IPv6 | 地址族路径 |
| HTTP vs HTTPS | TLS/安全层与更低层传输 |
| hostname vs SNI-correct pinned-address test | resolver 与 transport |
| small vs large traffic | MTU/丢包/拥塞 |
| 同一目标换设备 | endpoint-local 与 network-wide |
| 同一设备换网络 | access-network 与 endpoint |

## 证据语义

- `LISTEN`：只证明存在本地 socket；
- Proxy `CONNECT 200`：只证明 proxy 接受了隧道建立；
- SOCKS `request granted`：只证明 proxy 接受了请求；
- VPN “connected”：只证明控制面状态；
- 最近的 WireGuard handshake：证明 peer session 存在，路由/转发/应用仍可能失败；
- Tailscale relay/DERP：证明通过 relay 存在连通性，direct path 仍可能失败；
- 远端 HTTP 4xx/5xx：较低层可能已经正常；
- strategy/group `alive=true`：嵌套 child/final endpoint 仍可能失败；
- traceroute hop loss：中间节点 ICMP 行为不等于端到端丢包。

## MTU / PMTU 分支

出现 TCP connect 成功但 TLS 卡住、小请求正常而大传输失败、隧道流量选择性失败，或单向明显更差时，优先检查 MTU。

先只读检查接口/隧道 MTU、不同 payload 大小，并在可用时抓包。不要先修改 MTU。

## Proxy、VPN 与 overlay 分支

读取 `references/proxy-vpn-overlay.md`。

通用顺序：

```text
本地入口
→ 命中的策略
→ 选中的 group / peer / gateway
→ final endpoint 或 DIRECT
→ endpoint reachability
→ tunnel/transport health
→ target
```

厂商 API 和 CLI 是证据来源，不是默认假设。

## TLS / HTTP 分支

读取 `references/tls-http.md`。

关键规则：

> 阻止有效 TLS 响应到达的更早路径失败，也可能表现为 TLS error。

先使用范围窄的诊断开关，再考虑宽泛的不安全 bypass。

## 变更与授权

任何持久化或有干扰性的网络变更前，说明：

```text
变更对象：
影响范围：
变更依据：
风险：
最坏情况：
回滚：
验证：
授权状态：
```

路由、DNS、system proxy、firewall、VPN/overlay routing、WireGuard AllowedIPs、proxy policy/group selection、MTU、接口禁用/启用或有干扰性的服务重启，都需要显式批准。

## 敏感数据

不要索取或回显 private key、preshared key、API token、controller secret、VPN auth key、proxy password 或完整 subscription URL。

除非确实需要推理路由，否则尽量减少 public IP、hostname、peer name、身份信息和内部网络细节。

## 命令或脚本错误处理

把输出分成：

1. 诊断脚本/工具错误；
2. 权限或环境限制；
3. 实际网络证据。

不要把 shell 语法、缺少二进制、API authentication failure 或编码问题当成网络证据。

## 完成标准

只有满足以下条件才说“已解决”：

- 原始失败工作流成功；
- 独立对照也成功；
- 实际路径符合预期路径；
- 已处理最早失败层；
- 并发的次要问题已分开；
- 变更和回滚方式明确。

最终总结：

```text
结论：
根因：
最早失败层：
预期路径：
实际路径：
关键证据：
变更：
验证：
次要问题：
残余风险：
回滚：
```

## 参考资料

- 通用证据模型：`references/evidence-model.md`
- Windows 适配器：`references/platform-windows.md`
- Linux/BSD 适配器：`references/platform-linux.md`
- macOS 适配器：`references/platform-macos.md`
- 受限/移动端/路由器环境：`references/platform-limited.md`
- Proxy/VPN/overlay 适配器：`references/proxy-vpn-overlay.md`
- TLS/HTTP 分支：`references/tls-http.md`
- 来源索引：`references/sources.md`

最高优先级规则：在进行持久化网络变更前，用最小侵入的证据识别实际路径和最早失败层。
