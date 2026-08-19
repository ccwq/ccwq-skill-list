---
name: network-debug
disable-model-invocation: true
description: Diagnose network connectivity and path failures across desktops, servers, routers, NAS devices, virtual machines, containers, mobile devices, proxies, VPNs, and overlay networks. Use for DNS failures, routing problems, TCP/UDP loss or timeout, HTTP/HTTPS and TLS errors, proxy failures, MTU issues, asymmetric paths, split tunneling, and VPN/overlay connectivity problems. Adapt the investigation to the actual platform and tools available; prefer evidence-driven, minimally invasive troubleshooting over device- or vendor-specific assumptions.
compatibility: Cross-platform. Supports Windows, Linux, macOS, BSD-like systems, routers/NAS appliances, containers/VMs, and environments where only application-level tests are available.
metadata:
  version: "0.2.0"
---

# Network Debug

## Purpose

Locate the first failing layer and the actual network path before proposing a fix.

This skill is intentionally **device-agnostic and vendor-agnostic**. Platform, VPN, proxy, router, and application-specific commands are adapters to the same diagnostic model, not the model itself.

Supported environments include desktops, servers, routers, NAS appliances, VMs, containers, mobile devices, proxies, VPNs, overlays, dual-stack networks, split tunnels, and multi-homed hosts.

## Core model

Always reason about the path as a sequence of boundaries:

```text
Application
→ name resolution
→ interface / source address
→ routing / policy routing
→ transport (TCP / UDP / ICMP)
→ optional proxy / VPN / tunnel ingress
→ optional policy / peer / outbound selection
→ remote transport path
→ TLS / security negotiation
→ HTTP or application protocol
→ remote application
```

Not every environment contains every layer.

Always answer:

1. What path was expected?
2. What path was actually used?
3. What is the earliest layer with direct evidence of failure?
4. Are there multiple independent failures?

## General principles

1. **Path before product.** Never begin by blaming an OS, proxy, VPN, DNS, router, or TLS just because its name appears in an error.
2. **Earliest failing layer wins.** Late-stage errors may be symptoms of earlier network failures.
3. **Use controlled comparisons.** Prefer tests changing one variable: direct/proxy, tunnel on/off, target A/B, IPv4/IPv6, HTTP/HTTPS, hostname/address, small/large traffic.
4. **Evidence has boundaries.** A local proxy CONNECT proves ingress acceptance only. A VPN “connected” state proves control-plane state only. Ping failure does not prove TCP failure.
5. **Multiple roots are allowed.** Keep separate fault chains until evidence shows a shared root.
6. **Read-only first.** Observe before changing configuration.
7. **Bypasses are diagnostic variables, not fixes.** Do not turn disabled validation, firewall, IPv6, revocation, or policy into a permanent fix without root-cause proof.
8. **Reproduce the original failure after repair.** A substitute test is insufficient.

## Interaction model

When the user is actively executing diagnostics, work in short rounds:

```text
Main line: round n/total | stage
Goal:
Operation type: read-only / low-risk change / high-risk change
Why this test:
Command or action:
Expected return:
```

Do not ask for facts already visible in logs. Choose one high-information step per round unless batching a small number of read-only checks is clearly more efficient.

If a platform supports automated result capture, prefer that over asking the user to manually copy many fragments.

## Platform adaptation

Identify the environment from existing evidence whenever possible:

- OS/platform and shell/UI.
- Local or remote endpoint.
- Whether the user controls one or both ends.
- Available diagnostic tools.
- Whether traffic crosses a proxy, VPN, tunnel, VM, container, router, or overlay.

Then load only relevant adapters:

- Windows: `references/platform-windows.md`
- Linux/BSD: `references/platform-linux.md`
- macOS: `references/platform-macos.md`
- Mobile/router/restricted UI: `references/platform-limited.md`
- Proxy/VPN/overlay: `references/proxy-vpn-overlay.md`
- TLS/HTTP: `references/tls-http.md`

The generic diagnostic tree remains authoritative.

## Layered diagnostic tree

### L0 — Process / service / local endpoint

Confirm local process, service, listener, interface, or gateway state. A local listener proves only local availability.

### L1 — Name resolution

Determine resolver path, A/AAAA results, split DNS, VPN/overlay DNS, and cross-device differences. Successful `nslookup`/`dig` does not prove the application uses the same resolver path.

### L2 — Interface / source address / routing

Determine chosen source address, egress interface, next hop, route specificity, metric/policy, tunnel overrides, and possible asymmetry. Inspect the route to the actual destination address, not only the default route.

### L3 — Transport

Separate TCP, UDP, and ICMP.

- TCP timeout, refused, reset, and success have different meanings.
- UDP should use protocol-aware evidence where possible.
- ICMP is supplementary and may be filtered.

### L4 — Proxy / VPN / tunnel ingress

Determine whether the local proxy/tunnel accepted the request. CONNECT accepted, SOCKS granted, interface up, or overlay authenticated does not prove remote data-plane success.

### L5 — Policy / peer / outbound selection

Determine which rule, policy, group, peer, gateway, endpoint, or DIRECT path was actually selected. Recurse through nested selectors when needed.

Never modify a default/MATCH/fallback policy before proving that the failing flow reaches it.

### L6 — Remote path and path characteristics

Investigate endpoint reachability, NAT, asymmetry, relay/direct behavior, congestion, packet loss, MTU/PMTU, and middleboxes.

Raise MTU suspicion when small traffic works but TLS, large responses, uploads, or tunneled traffic stalls.

### L7 — TLS / security negotiation

Only diagnose TLS after lower path layers are sufficiently established.

Separate:

- no TLS response;
- protocol/cipher negotiation;
- SNI;
- certificate chain;
- revocation;
- TLS interception.

A client error containing “TLS” is not proof TLS is the first failing layer.

### L8 — HTTP / application protocol

Identify who generated the response.

- Remote 403/404 often proves the network path reached an HTTP-speaking service.
- 502 from a local proxy often points to proxy outbound.
- 502 from a remote reverse proxy points to a different boundary.

## Controlled comparison matrix

| Comparison | Primary distinction |
|---|---|
| direct vs proxy | proxy/tunnel path vs base path |
| tunnel on vs off | tunnel routing/policy |
| target A vs B | target-specific vs path-wide |
| IPv4 vs IPv6 | address-family path |
| HTTP vs HTTPS | TLS/security vs lower transport |
| hostname vs SNI-correct pinned-address test | resolver vs transport |
| small vs large traffic | MTU/loss/congestion |
| same target from another device | endpoint-local vs network-wide |
| same device on another network | access-network vs endpoint |

## Evidence semantics

- `LISTEN`: local socket exists only.
- Proxy `CONNECT 200`: proxy accepted tunnel setup only.
- SOCKS `request granted`: proxy accepted request only.
- VPN “connected”: control-plane state only.
- Recent WireGuard handshake: peer session exists; routing/forwarding/app may still fail.
- Tailscale relay/DERP: connectivity exists through relay; direct path may still fail.
- Remote HTTP 4xx/5xx: lower layers may already be functioning.
- Strategy/group `alive=true`: a nested child/final endpoint may still fail.
- Traceroute hop loss: intermediate ICMP behavior is not equal to end-to-end loss.

## MTU / PMTU branch

Prioritize MTU when TCP connect succeeds but TLS stalls, small requests work while large transfers fail, tunneled traffic fails selectively, or one direction is much worse.

Start read-only with interface/tunnel MTU, payload-size comparisons, and packet capture if available. Do not change MTU first.

## Proxy, VPN, and overlay branch

Read `references/proxy-vpn-overlay.md`.

Generic sequence:

```text
local ingress
→ matched policy
→ selected group / peer / gateway
→ final endpoint or DIRECT
→ endpoint reachability
→ tunnel/transport health
→ target
```

Vendor-specific APIs and CLIs are evidence sources, not assumptions.

## TLS / HTTP branch

Read `references/tls-http.md`.

Key rule:

> A TLS error can be caused by an earlier path failure that prevents a valid TLS response from arriving.

Use narrow diagnostic toggles before broad insecure bypasses.

## Changes and authorization

Before any persistent or disruptive network change, state:

```text
Object being changed:
Scope:
Why this change is justified:
Risk:
Worst case:
Rollback:
Verification:
Authorization status:
```

Require explicit approval for routes, DNS, system proxy, firewall, VPN/overlay routing, WireGuard AllowedIPs, proxy policy/group selection, MTU, interface disable/enable, or disruptive service restarts.

## Sensitive data

Do not request or echo private keys, preshared keys, API tokens, controller secrets, VPN auth keys, proxy passwords, or full subscription URLs.

Minimize public IPs, hostnames, peer names, identities, and internal network details unless needed to reason about routing.

## Handling command/script errors

Classify output into:

1. diagnostic-script/tool error;
2. permission/environment limitation;
3. actual network evidence.

Never treat shell syntax, missing binaries, API authentication failures, or encoding problems as network evidence.

## Completion criteria

Do not say “resolved” until:

- the original failing workflow succeeds;
- an independent control succeeds;
- the actual path matches the intended path;
- the earliest failing layer has been addressed;
- concurrent secondary issues are separated;
- changes and rollback are known.

Final summary:

```text
Conclusion:
Root cause:
Earliest failing layer:
Expected path:
Actual path:
Key evidence:
Changes:
Verification:
Secondary issues:
Residual risks:
Rollback:
```

## References

- Generic evidence model: `references/evidence-model.md`
- Windows adapter: `references/platform-windows.md`
- Linux/BSD adapter: `references/platform-linux.md`
- macOS adapter: `references/platform-macos.md`
- Limited/mobile/router environments: `references/platform-limited.md`
- Proxy/VPN/overlay adapters: `references/proxy-vpn-overlay.md`
- TLS/HTTP branch: `references/tls-http.md`
- Source index: `references/sources.md`

Highest-priority rule: identify the actual path and earliest failing layer with minimally invasive evidence before making persistent network changes.
