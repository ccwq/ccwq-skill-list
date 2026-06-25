---
name: rd-mode
description: 远程开发模式规则,rd-mode。触发条件：用户提到 host/server 协作、需要在远程环境运行代码、或涉及 CDP 浏览器操作（abc 命令）时，view 此文件后再执行任务。首次使用或用户调用 `rd-mode --init` 时，执行下方「首次使用 / 初始化」流程生成配置。
---

# 远程开发模式（rd-mode）

## 环境架构

- **server**：agent 所在的本机环境，无桌面，代码通过磁盘映射从 host 挂载
- **host**：具有桌面和浏览器的远端环境，服务在此运行，代码在此执行
- **路径映射**：host 的项目路径和 server 的挂载路径对应同一份代码，修改在 server 进行、执行在 host 进行

## 操作边界

agent 在 server 上**可以**做：

- 读取、修改、分析代码文件
- 搜索、检查目录结构
- 准备命令供用户在 host 执行

agent 在 server 上**不做**：

- 直接运行应用代码或测试
- 启动服务、执行构建
- 触发任何需要桌面/浏览器的操作

> 例外：写入配置文件 `~/.config/rd-mode/.env`（`--init` 流程）属于允许操作——它是配置而非应用代码，不与上述边界冲突。

## 首次使用 / 初始化

用户首次使用，或显式调用 `rd-mode --init` 时，按以下流程生成配置：

1. **展示模板**：先把 `.env.example`（位于本 skill 目录）的完整内容贴给用户，让其明确需要提供的内容。
2. **收集必填值**：用 `AskUserQuestion` 询问两个必填值——
   - `RHost`：host 远端环境的 IP 或 hostname
   - `CDP_PORT`：host 浏览器的 CDP 远程调试端口
3. **写入配置**：将收集到的值套入 `.env.example` 模板，写入 `~/.config/rd-mode/.env`（目录不存在则一并创建）。`CDP_URL` 及各 alias 为派生/固定内容，按模板原样写入，无需询问。
4. **覆盖保护**：若 `~/.config/rd-mode/.env` 已存在，先提示用户并确认后再覆盖，避免误删已有配置。
5. 完成后告知用户配置已生成，可开始使用 `abc` 等命令。

## 通知用户格式

需要在 host 执行时，使用以下格式通知用户：

```
【需要在 host 执行】
<具体命令或操作步骤>
完成后请告知结果（或贴出输出）
```

保持简洁，只给必要的命令和说明，不重复解释背景。

## 浏览器操作（CDP / abc）

`abc` 是预配置了正确 CDP 参数的 agent-browser 封装，连接到 host 上的浏览器。

前提：host 浏览器需以远程调试端口启动并监听非 localhost 地址，server 才能连入，例如 `chrome --remote-debugging-port=<CDP_PORT> --remote-debugging-address=0.0.0.0`（`<CDP_PORT>` 与配置中的 `CDP_PORT` 一致）。

### 每次新 shell 会话前必须先执行

```bash
source ~/.bashrc && source ~/.config/rd-mode/.env
```

若 `~/.config/rd-mode/.env` 不存在，不要静默继续——提示用户先运行 `rd-mode --init` 生成配置。

### 常用操作

- 连通性测试：`abc tab`（列出 host 浏览器当前标签页，快速验证连接是否正常）
- 其余操作使用 `abc <subcommand>` 替代 `agent-browser <subcommand>`

### 异常处理流程

abc 命令出现异常时：

1. 输出完整错误信息
2. 按以下步骤自检并给出可能原因和建议操作：
   - `echo $CDP_URL`：确认环境变量已加载（为空说明未 source 配置，回到上面「每次新 shell 会话前必须先执行」）
   - `curl $CDP_URL/json/version`：测试 host 浏览器 CDP 是否活跃（连不上说明 host 浏览器未开启 CDP 或端口/IP 不对）
   - `abc tab`：连通性复测
3. 停止，等待用户确认后再继续，不自行重试
