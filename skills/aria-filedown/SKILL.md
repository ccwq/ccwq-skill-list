---
name: aria-filedown
description: 手动使用 aria2 执行稳定下载。仅当用户明确调用，或普通下载已出现网络错误且用户同意切换时使用；支持大文件、SDK、模型、压缩包、安装器和断点续传。
disable-model-invocation: true
---

# aria-filedown

这是一个手动调用的下载辅助 Skill，不会自动接管下载任务。

## 何时建议使用

- 用户明确调用 `$aria-filedown`，或明确要求用 aria2 下载。
- 已发生 DNS、连接、TLS、传输、超时或 HTTP 5xx 等网络异常时，提示用户可切换至本 Skill；**收到当前下载目标的明确允许后**才执行。
- 用户明确反馈下载速度过慢时，可以提示此 Skill；不主动测速或预检 URL。

不要因为文件较大、来源在海外或“可能较慢”而自行调用。一次允许只覆盖当前目标的下载方式切换，不能复用于其他目标或后续下载。

## 执行边界

1. 先确认目标 URL、输出目录和当前下载目标的授权。
2. 先运行 `--check`；若缺少 aria2c，说明候选安装目录并单独征得安装确认。
3. 执行下载时，人类优先 `--progress tty`，脚本/Agent 消费事件时使用 `--progress jsonl`。
4. 只在已获允许时读取代理配置；回报代理**来源**，不要回显包含凭据的代理 URL。

## 代理优先级

`--proxy` / `-p` > 进程环境 > 项目 `.env`；每一层内 `ARIA2_PROXY` > `PROXY`。

- 项目 `.env` 是 Git 仓库根目录的 `.env`；不在 Git 仓库时回退到当前工作目录。
- 只支持 `ARIA2_PROXY` 和 `PROXY`，不支持拼写错误的 `AIRA2_PROXY`。
- `.env` 仅作本次读取，不写入、不导出、不显示其中的值。

## 常用调用

```bash
# 仅检查 aria2c
python scripts/aria2-wrapper.py --check

# 指定代理下载；-p 与 --proxy 等价
python scripts/aria2-wrapper.py -p http://localhost:7897 -- https://example.com/file.zip

# 缺少 aria2c 时，先经用户确认再安装并下载
python scripts/aria2-wrapper.py --install --install-dir ./bin/aria -- https://example.com/file.zip

# 输出 JSONL 状态
python scripts/aria2-wrapper.py --progress jsonl -- https://example.com/file.zip
```

包装器保留 aria2 `1.37.0` 的固定版本。安装包下载发生网络错误时，按两轮、每轮两次重试；轮内等待 10 秒，轮间等待 25 秒，失败后仅提示可选代理地址。
