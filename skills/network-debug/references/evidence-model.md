# Generic Evidence Model

Model every failing flow as:

```text
source process/device
→ source address
→ resolver result
→ route/interface
→ transport
→ optional proxy/VPN/tunnel
→ optional policy/peer/outbound
→ remote path
→ target
→ security/session
→ application response
```

Prefer evidence nearest the failing boundary. Proxy logs showing `dial timeout` are stronger for outbound diagnosis than a client-side TLS error. Route lookup for the actual target is stronger than default-route inspection. Transfer counters are stronger than a UI “connected” badge.

Maintain at least two plausible hypotheses until a controlled test separates them.

Do not collapse distinct chains such as certificate-revocation failure for one target and proxy-outbound timeout for another into a single “TLS problem”.
