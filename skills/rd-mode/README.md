# rd-mode

远程开发模式规则。约束 agent 在「无桌面的 server」上协作、把需要执行的操作交给「有桌面/浏览器的 host」，并统一通过 `abc` 命令对 host 浏览器做 CDP 操作。

适用场景：本机(server)无桌面、代码挂载自远端(host)，需要在 host 上跑服务、操作浏览器。

## 安装

随本仓库一起安装（见仓库根 README），或单独指定：

```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list --skill rd-mode
```

安装到 Claude Code：

```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list --agent claude-code --skill rd-mode
```

## 首次使用

在 Claude 会话中调用本 skill 并带 `--init`，按问答补全 `RHost`、`CDP_PORT` 两个值，会生成配置到 `~/.config/rd-mode/.env`：

```
rd-mode --init
```

配置项含义见 [`.env.example`](./.env.example)。

## 更多

具体操作规则、host/server 架构、`abc` 命令用法与故障排查，均在 [`SKILL.md`](./SKILL.md) 中（由 Claude 自动加载，无需手动阅读）。
