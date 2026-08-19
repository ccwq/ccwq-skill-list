# 受限 / 移动端 / 路由器 / Appliance 适配器

在没有完整 shell 时使用。

即使可观测性受限，也要保持相同的分层模型。

收集现有信息：

- 应用错误详情；
- IP/gateway/DNS 状态；
- VPN/proxy 状态；
- route/policy UI；
- peer/endpoint 状态；
- 日志/计数器；
- 备用网络测试；
- 同一网络上的备用设备。

移动端常用对照包括 Wi-Fi 与 cellular、VPN 开启与关闭、browser 与 app。

在路由器/NAS appliance 上，修改 WAN、NAT、firewall、DNS、routes、MTU 或 VPN 设置前，优先查看只读状态和日志。
