# network-debug

跨设备、跨平台、跨代理/VPN 产品的网络故障诊断 Skill。

核心是统一路径模型，而不是某个设备或软件：

```text
应用
→ DNS
→ 接口/路由
→ TCP/UDP
→ 可选代理/VPN/隧道
→ 策略/peer/outbound
→ 远端路径
→ TLS
→ HTTP/应用
```

Windows、Linux、macOS、路由器/NAS、容器/VM、移动端只是不同的观测适配器。

Clash/Mihomo、Tailscale、WireGuard 只是代理/VPN/overlay 分支中的实现示例。

Windows 环境额外支持 clipboard-first 的人机诊断方式，但这不是 Skill 的全局约束。
