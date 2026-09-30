# Alpine / OpenWrt 实证记录（2026-09-30）

## 镜像与安装路线

| 系统 | 镜像 | digest | 路线 |
|---|---|---|---|
| Alpine 3.24.2 | docker.io/library/alpine:3.24.2 | sha256:d56c381f961d307a21b3ca004cf1e3910f106644aefb1f43e654c8a56c4fd395 | 同发行版apk包 + 官方ble归档 |
| OpenWrt25.12.5 x86/64 | docker.io/openwrt/rootfs:x86-64-25.12.5 | sha256:c5d5f05bab4ce06a4e840b3573671a06ec8ae9842273188ffc53f7021836b8e2 | 匹配发行版apk依赖 + 经官方API摘要核验上游工具 |

来源：[Alpine支持分支](https://alpinelinux.org/releases/)、[OpenWrt官方容器仓库](https://github.com/openwrt/docker)、[OpenWrt releases](https://downloads.openwrt.org/releases/)。版本均为本次测试输入，不是skill最低/默认版本。

Alpine：Bash5.3.9、bash-completion2.17、fzf0.73.1、zoxide0.9.9、Python3.14.7。OpenWrt：Bash二进制5.3.20（包5.3-r5）、Python3.13.15；仓库无fzf/zoxide/bash-completion，使用fzf0.74.4 Linux amd64、zoxide0.10.0 x86_64-musl及bash-completion2.18.0纯脚本。未混用Alpine包。OpenWrt用apk不是opkg。

上游摘要（来自官方GitHub API，经下载字节核对；不是独立签名认证）：
- fzf：05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504
- zoxide：2d93385b99f3e82cf2701609a1bffcad863fbeb75aa3fe7eb6be4d29be68b1ae
- bash-completion：88bcf85124f77f74f2f2f8bcd16ac4382d807a827ede742a64940c7116aea33f
- ble官方发布v0.4.0-devel3的-2归档：bdcdcfff216495403adf82a701fe41675f64b64644dc77caabd3e015871ebd61；HTTPS来源，无API独立digest。completion归档含测试hardlink，审查后仅提取普通文件/目录，未宣称全部别名完备。

## 实测矩阵

| 验证 | Alpine | OpenWrt |
|---|---|---|
| 干净Bash readiness/Tab | 2/2 | 2/2（普通账号需私有TMPDIR） |
| 全插件交互 | 两账号各6/6 | 两账号各6/6 |
| 实际HOME/XDG首次登录 | 2/2 | runtime修复后2/2，两账号确认 |
| 配置单测 | 25pass + 1Windows-only skip | 同左 |
| PTY单测 | 23/23 | 23/23 |
| 生命周期回滚 | 最终8/8 | 最终8/8 |
| 无配置账号负对照 | 基础2pass，插件4unsupported | 同左 |
| 容器root实际XDG | 未专项测试 | 全6/6、非交互无新增、启动文件恢复不存在 |
| 默认ash、系统profile | 保留且profile哈希不变 | 保留且profile哈希不变 |

全插件6项=就绪、受控路径Tab、fzf历史/文件/目录候选与取消、ble加载/attach/选项；不等于建议接受、视觉、git语义或fzf **全覆盖。运行用户的账号默认shell依然ash。

## 红绿迭代

1. Alpine setgid HOME使新state继承2700，夹具拒绝；仅对新建目录显式0700，新增回归，原HOME保持原样。
2. 无默认Bash登录链：只写.bashrc时插件unsupported；增加独立Bash-only .bash_profile桥接后6/6，不改公共.profile。
3. 回滚原本不存在.bashrc时夹具正确删除，而生命周期读文件报错；按manifest.original_exists验“恢复不存在”，复验8/8。
4. OpenWrt /tmp0755，普通账号无可写临时目录；使用其私有TMPDIR，不改系统/tmp。验证器当前对临时目录创建失败仍可抛异常，需外层预检，此项未声称已结构化修复。
5. OpenWrt ble报缺tty/od；使用匹配仓库coreutils-tty/od，另有gawk/coreutils-stty。ncurses-utils包不存在，不照搬其他系统包名。
6. 隔离XDG成功但真实XDG失败：ble无可写runtime退回共享安装树。容器内预置/run/user/<uid>属主0700，Bash init仅XDG未设置时选用，真实登录通过；不放宽共享安装树。
7. 原始OpenWrt profile输出banner并按USER设置HOME；生命周期改为启用/回滚后输出与退出码对照，不删除banner，不将其误判为新增噪声。

## 回滚与资源边界

自动回归账号managed .bashrc/init已回滚；额外Bash登录桥接、缓存、runtime、测试依赖仍保留并另列清理。OpenWrt root临时.bashrc/.bash_profile已按字节校验删除恢复原始不存在，cache保留。用户手测labuser增强配置保留。

容器bash-skill-musl-alpine、bash-skill-musl-openwrt均purpose=bash-skill-musl-lab，768MiB/256PID，无宿主HOME挂载、无端口发布、无privileged。OpenWrt入口为sh等待，不运行完整路由服务。未修改Podman machine/业务资源；临时工作集中仓库.planning/bash-skill-musl，清理需用户另确认。

## 限制

本轮是用户空间容器验证，不认证真实OpenWrt设备、procd/内核/无线、SSH/PAM、重启后/run生命周期或资源性能。root测试与普通账号分开；通用配置夹具仍拒绝root。未完成独立逐项人工体验认证、完整终端模拟或模型触发率benchmark。bash-completion非所有语义脚本被逐项运行。locale设置不代表Unicode宽度已验证。
