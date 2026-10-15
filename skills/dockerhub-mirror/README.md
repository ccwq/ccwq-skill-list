# Docker Hub Mirror Skill

诊断 Docker Hub 拉取失败或缓慢的原因。诊断范围包括网络、TLS、token 和限流错误。

获得授权后，工具可以探测和评分镜像候选。它也可以发现新候选和维护本地候选缓存。

工具只生成建议的 `docker pull` 命令。它不修改 Docker daemon 配置，也不执行镜像拉取。

CLI 仅使用 Node.js 标准库。运行探测不依赖 Docker daemon。

## 环境要求

- Node.js 18.17 或更高版本
- Windows 10/11、Linux、macOS 或其他支持 Node 的类 POSIX 系统
- 实时探测镜像源需要网络

## 安装

复制整个目录，保持 `SKILL.md`、`bin/`、`scripts/`、`config/`、`references/` 在一起。

| 平台 | 项目级位置 | 用户级位置 |
|------|-----------|-----------|
| Codex | `.codex/skills/dockerhub-mirror/` | `$CODEX_HOME/skills/dockerhub-mirror/` |
| Claude Code | `.claude/skills/dockerhub-mirror/` | `~/.claude/skills/dockerhub-mirror/` |
| 通用 Agent Skills | 框架约定的 skill 目录 | 框架约定的用户 skill 目录 |

Claude Code 中手动调用为 `/dockerhub-mirror`；Codex 及兼容 Agent 可通过 description 匹配或按名称显式选择。

## 调用方式

必须使用安装位置的绝对路径：

```text
node "/absolute/path/to/dockerhub-mirror/bin/dockerhub-mirror.mjs" --help
```

需要独立的 `dockerhub-mirror` 命令时，可以在安装目录执行 `npm link`。

## 授权门禁

未达成 `ok` 共识前，只能使用 `--dry-run`。

收到 `ok` 后，Agent 必须展示范围明确的计划。用户回复 `授权执行` 后，才可以运行以下写入缓存的模式：

- 默认快速检测。
- `--deep`。
- `-f/--scrape`。
- `--add`。
- `--remove`。
- `--retry-quarantine`。

`--dry-run` 会抑制缓存创建与修改，与 `--add`、`--remove` 组合时也只用于预览已商定的操作。

缓存默认位于 `%USERPROFILE%\.config\dockerhub-mirror-skill.ini`（Windows）或 `~/.config/dockerhub-mirror-skill.ini`（Linux/macOS）。

## 结果解读

| 退出码 | 含义 |
|--------|------|
| `0` | 请求的模式已完成；探测模式下存在合格推荐 |
| `2` | 模式已完成，但没有候选合格，或 add 请求被拒绝 |
| `1` | 参数、配置、文件系统或运行时错误 |

探测结果只适用于当前主机、DNS 路径、ISP 和测试时刻。公共代理测试通过不等于供应链可信。

## 文档分工

- 用户侧参数速查：根 [README](../../README.md#dockerhub-mirror)。
- [SKILL.md](SKILL.md)：运行分支、步骤顺序、完成条件与安全门禁。
- [references/cli.md](references/cli.md)：命令语法、副作用分级、路径与退出码。
- [references/decision-gate.md](references/decision-gate.md)：讨论、共识、授权、暂存与回滚协议。
- [config/defaults.json](config/defaults.json)：阈值、上限、探测镜像、隔离策略与评分权重。

## 开发验证

```text
npm test
npm run lint
npm run check
```

测试使用本地 mock registry 和临时目录，不需要 Docker 或公网。
