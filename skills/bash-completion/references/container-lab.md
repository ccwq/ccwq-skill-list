# 隔离安装回归

用户授权容器验证时走此分支。容器验证发行版用户空间，不等于独立内核虚拟机、SSH/PAM 或宿主终端全覆盖。

## 1. 建立边界

现场发现容器引擎、连接、machine、已有资源及镜像摘要。创建独有名称/标签，无宿主 HOME 挂载、无发布端口、不复用业务容器。限制资源，保留镜像来源、包清单、账号/HOME/UID。Windows Podman 的 machine 与测试容器分别记录；安装身份与交互账号分开。

**完成标准：** 可按资源清单精确停止本次资源；用户手测账号与自动回滚账号分开，手测期间不改变其配置或停止容器。

## 2. 从干净系统安装

按 [安装回滚](installation-rollback.md) 分类工具、检查代理及实际集成文件。安装包后使用不同普通账号验证“工具全局可用”和“仅目标账号启用配置”。从可信官方渠道获取 ble 发布物，记录来源与摘要；摘要相同是内容一致性，不是独立签名认证。

配置中只放现场发现的路径。包缺失、source 失败、适配层失败时停下，不预置“全部成功”标记。新账号正常缓存路径必须可用。login 与 non-login 的接入分别发现；测试夹具仅编辑 .bashrc，不会替用户修改 .profile。

## 3. 配置生命周期夹具

[configure.py](../evals/container-lab/configure.py) 仅用于显式选择的可丢弃账号，不是通用生产安装器。以非 root HOME 属主运行，可信 init source 也须该账号所有；路径都为绝对路径。

```bash
python3 -B configure.py --home "$HOME" --init-source "$HOME/init-source.bash" --action apply
# 同内容第二次应 unchanged
python3 -B configure.py --home "$HOME" --init-source "$HOME/init-source.bash" --action apply
python3 -B configure.py --home "$HOME" --init-source "$HOME/init-source.bash" --action rollback
```

拒绝符号链接、已有不明 init、重复/畸形标记、属主错误、摘要/权限漂移；先 bash -n 再原子替换单文件。保存原字节/权限及 manifest。多文件操作不是事务；中断留证据并拒绝盲目重跑。回滚遇用户后续编辑应拒绝，不覆盖。包与缓存的回滚另行记录。

## 4. 行为与回归

先运行 [PTY 单测](../evals/test_verify_pty.py) 与 [配置单测](../evals/container-lab/test_configure.py)，区分 pass 与平台 skip。按实际配置账号运行 PTY 全项并重复；未配置账号应只有基础能力，不因系统装包就自动加载 ble。

在**可丢弃回归账号**已 apply 后运行 [lifecycle.py](../evals/container-lab/lifecycle.py)：显式传 --verifier 与 --init-source，验证重复 source、PATH/提示钩子、z 跳转、原始 cd、非交互无噪声、后续编辑拒绝及精确回滚。它会生成受控编辑并回滚，不能用于用户正在手测的账号。

[real-xdg.py](../evals/container-lab/real-xdg.py) 接收 verifier 路径，在可丢弃账号中保留实际 XDG 设置，允许写真实缓存，验证首次登录路径。它是隔离测试的补充，不是通用安全探针。首次缺缓存红测、创建私有目录后绿测都保留。

**完成标准：** 原始失败、最小修改、相同环境对照、负对照、重复结果均留证据；建议接受、高亮视觉、fzf `**`、git 语义未测则明确列出。网络阻碍另一发行版时记录未覆盖，不借用其他系统结果。

## 5. 交付

提供主机侧 exec 命令、测试账号、实际修改、镜像摘要、通过/失败/未测表、回滚证据及保留资源。用户正在测试的容器保留运行；其他资源仅按本次标签/名称处理，批量删除遵循项目授权。不把测试账号、引擎实例名、代理或版本固化进主流程。
