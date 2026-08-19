# macOS 适配器

典型只读命令：

```sh
ifconfig
route -n get <ip>
netstat -rn
scutil --dns
networksetup -getwebproxy <service>
networksetup -getsecurewebproxy <service>
curl -v ...
```

查看监听 socket（可用时）：

```sh
lsof -nP -iTCP -sTCP:LISTEN
```

不要假设 macOS system proxy、应用 proxy 和 VPN routing 完全相同。
