# macOS Adapter

Typical read-only primitives:

```sh
ifconfig
route -n get <ip>
netstat -rn
scutil --dns
networksetup -getwebproxy <service>
networksetup -getsecurewebproxy <service>
curl -v ...
```

Listening sockets, when available:

```sh
lsof -nP -iTCP -sTCP:LISTEN
```

Do not assume macOS system proxy, application proxy, and VPN routing are identical.
