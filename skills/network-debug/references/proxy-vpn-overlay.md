# Proxy / VPN / Overlay Adapters

## Generic proxy

```text
client
→ local proxy ingress
→ rule/policy
→ selected outbound
→ remote connect
→ target
```

Check ingress acceptance, rule selection, final outbound, endpoint health, and outbound error.

## Rule-based proxies

For Clash/Mihomo and similar engines:

1. Which rule matched?
2. Which policy/group did it select?
3. Is that group recursive?
4. What final proxy/DIRECT path was used?
5. Did final outbound dial succeed?

Runtime APIs/logs are preferred over guessing static config.

For Mihomo-compatible controllers, useful read-only endpoints may include `/version`, `/configs`, `/proxies/<name>`, `/connections`, and `/logs`.

Do not assume changing MATCH/default affects flows matched by earlier domain/IP rules.

## Tailscale

Useful read-only CLI commands when installed:

```text
tailscale status
tailscale status --json
tailscale netcheck
tailscale ping <peer>
tailscale dns status
```

Interpret direct vs relay/DERP vs peer-relay as data-path information. Relay means connected indirectly, not offline.

Also consider exit node, subnet routes, accepted routes, DNS/MagicDNS, and route conflicts.

## WireGuard

Prefer:

```text
wg show
```

Do not request `wg showconf`, private keys, or preshared keys.

- no recent handshake after traffic: endpoint/UDP/NAT/firewall/peer path;
- recent handshake but app fails: AllowedIPs/routes/forwarding/firewall/DNS/MTU;
- tx rises but rx does not: return path or remote handling;
- tx/rx rise: tunnel carries traffic; continue upward.

## Other VPNs

Apply:

```text
control-plane connected
≠ correct routes
≠ working data plane
≠ working application
```
