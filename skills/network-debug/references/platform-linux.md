# Linux / BSD 适配器

使用系统已有工具，不要自动安装软件包。

典型只读命令：

```sh
ip addr
ip route
ip rule
ss -lntup
resolvectl status
getent ahosts <host>
curl -v ...
```

替代命令可能包括 `ifconfig`、`netstat`、`route`、`dig`、`drill` 或 `host`。

针对具体目标：

```sh
ip route get <ip>
```

在容器或 network namespace 场景中，要区分宿主机路由与容器路由，并识别 bridge/NAT/CNI 行为。宿主机成功不代表容器成功。
