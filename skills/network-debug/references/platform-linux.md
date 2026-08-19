# Linux / BSD Adapter

Use tools already present; do not auto-install packages.

Typical read-only primitives:

```sh
ip addr
ip route
ip rule
ss -lntup
resolvectl status
getent ahosts <host>
curl -v ...
```

Alternatives may include `ifconfig`, `netstat`, `route`, `dig`, `drill`, or `host`.

For a specific destination:

```sh
ip route get <ip>
```

In container/network-namespace cases, distinguish host routing from container routing and identify bridge/NAT/CNI behavior. Host success does not prove container success.
