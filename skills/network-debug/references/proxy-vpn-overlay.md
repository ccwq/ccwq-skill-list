# Proxy / VPN / Overlay 适配器

## 通用 Proxy

```text
客户端
→ 本地 proxy 入口
→ rule/policy
→ 选中的 outbound
→ 远端连接
→ 目标
```

检查入口是否接受、rule 选择、最终 outbound、endpoint 健康度和 outbound error。

## 基于规则的 Proxy

对于 Clash/Mihomo 和类似引擎：

1. 命中了哪条 rule？
2. 它选择了哪个 policy/group？
3. 该 group 是否递归？
4. 实际走了什么最终 proxy/DIRECT 路径？
5. 最终 outbound dial 是否成功？

优先使用运行时 API/log，而非猜测静态 config。

对于兼容 Mihomo 的 controller，可用的只读 endpoint 可能包括 `/version`、`/configs`、`/proxies/<name>`、`/connections` 和 `/logs`。

不要假设修改 MATCH/default 会影响被更早 domain/IP rule 命中的流量。

## Tailscale

已安装时可使用的只读 CLI 命令：

```text
tailscale status
tailscale status --json
tailscale netcheck
tailscale ping <peer>
tailscale dns status
```

把 direct、relay/DERP 和 peer-relay 视为 data-path 信息。Relay 表示间接连接，不代表离线。

还要考虑 exit node、subnet routes、accepted routes、DNS/MagicDNS 和 route conflict。

## WireGuard

优先使用：

```text
wg show
```

不要索取 `wg showconf`、private key 或 preshared key。

- 流量发生后仍没有近期 handshake：检查 endpoint/UDP/NAT/firewall/peer path；
- 有近期 handshake 但 app 仍失败：检查 AllowedIPs/routes/forwarding/firewall/DNS/MTU；
- tx 增长但 rx 不增长：检查 return path 或远端处理；
- tx/rx 都增长：tunnel 正在承载流量，继续检查上层。

## 其他 VPN

遵循：

```text
control-plane connected
≠ 正确 routes
≠ 可用 data plane
≠ 可用应用
```
