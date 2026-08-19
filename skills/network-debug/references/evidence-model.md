# 通用证据模型

将每条失败流建模为：

```text
源进程/设备
→ 源地址
→ resolver 结果
→ 路由/接口
→ 传输层
→ 可选的 proxy/VPN/tunnel
→ 可选的 policy/peer/outbound
→ 远端路径
→ 目标
→ security/session
→ 应用响应
```

优先使用最接近失败边界的证据。Proxy 日志中的 `dial timeout` 比客户端 TLS error 更能说明 outbound 问题；针对实际目标的 route lookup 比检查 default route 更有力；传输计数器比 UI 的“connected”徽章更可靠。

至少保留两个合理假设，直到受控测试将它们区分开。

不要把不同故障链合并成单一的“TLS 问题”，例如一个目标的 certificate-revocation failure 与另一个目标的 proxy-outbound timeout。
