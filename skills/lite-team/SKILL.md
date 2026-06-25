---
name: lite-team
description: 轻量多 Agent 协作技能，用一个 docs/bbs/lite-team-bbs.md 协作板在不同 Agent / session 间手动交接信息。当用户手动指定或切换开发角色（产品、开发、测试、架构、安全审计等）、要求跨 session 角色交接、要求读写或初始化 docs/bbs/lite-team-bbs.md 协作板，或要求结束 / 归档轻量协作时使用。普通单 Agent 任务、自动多 Agent 编排不使用。
---

# 轻量 BBS 多 Agent 协作

## 定位

这是一个**手动角色协作**技能：用一个短小的 `docs/bbs/lite-team-bbs.md` 在不同 Agent / session 之间交接必要信息。

- 不做自动调度，不维护长期 Agent 记忆。
- 当前角色只存在于当前对话；不要把“当前角色”写进 BBS。
- 用户是总控。用户可指定任意角色，例如产品、开发、测试、架构、安全审计。
- 除非用户要求，或主 Agent 明确要求子 Agent 读取，否则不要主动读取 BBS。
- 所有已验证、已处理且不再需要交接的信息都应从 `<message>` 删除。

## 角色切换

用户可用自然语言或短命令指定角色，二者等价：

```text
/role 开发
现在你是测试 Agent
切换到安全审计角色
```

切换后，仅执行该角色职责内的工作。角色边界不清时，简短向用户或目标角色提出问题；不要自行扩展范围。

切换到内置角色时，先读取对应人设文件，按其中的职责、限制和输出格式工作：

- 产品 → `references/roles/product.md`：澄清需求、验收、边界、说明文档；不改业务代码或测试代码。
- 开发 → `references/roles/dev.md`：实现业务功能、修复业务缺陷、运行必要验证；需求不清时写 BBS 给产品。
- 测试 → `references/roles/test.md`：维护测试、基于真实页面和真实流程验证；不改业务逻辑；业务缺陷写 BBS 给开发。
- 自定义角色：无对应文件时，遵守用户为该角色指定的权限和边界。

## 何时创建或读取 BBS

BBS 路径固定：`docs/bbs/lite-team-bbs.md`。

- 文件不存在时，只有在确实需要跨角色交接，或用户执行 `/bbs init` 时才创建。
- 用户说“读取协作板”“查看 BBS”或 `/bbs read` 时读取。
- 主 Agent 可明确要求子 Agent 读取或写入 BBS。
- 普通新 session、普通单角色任务，不自动读取、不自动创建。

初始化：

```bash
python3 scripts/bbs.py init --root .
```

脚本需 Python 3（≥3.8）；部分系统 `python` 仍指向 Python 2，请用 `python3`。

## BBS 格式

`lite-team-bbs.md` 是**面向 Agent 的结构化 Markdown**，允许 XML-like 标签 + YAML 列表；它不是严格 XML，也不要求 XML 属性加引号。

```md
# BBS

<message>
- id: m-20260625-01
  from: 开发
  to: 测试
  type: handoff
  summary: 登录异常分支已实现，请验证错误凭证、重复提交和接口超时。
  files: [src/auth/*, tests/auth/*]
  verify: npm test -- auth
  need: 反馈真实页面验证结果；业务缺陷回传开发。
</message>

<history>
- date: 2026-06-25
  summary: 登录异常处理完成；覆盖错误凭证、重复提交和超时，验收通过。
</history>
```

### `<message>` 规则

- 只放**当前仍需处理、确认或交接**的信息。
- 单条的固定核心字段：`id / from / to / type / summary`。
- 可选字段按需使用：`files / verify / need / risk / decision / detail / reply_to`。
- `to` 可为一个角色、`all` 或 `user`。
- `type` 常用值：`handoff / question / risk / bug / decision / verify`；确有必要可扩展。
- `id` 格式：`m-YYYYMMDD-NN`，同一天从 `01` 递增。
- 总数最多 7 条。写入前若将超过 7 条，先删除已处理项、合并重复项；仍超出则提示用户处理，不要硬塞。
- `summary` 长度按需，建议不超过 500 字；过长时先问用户是否拆分，或把详细内容转入 `docs/bbs/<topic>.md` 用 `detail` 引用，不要把长内容塞进 BBS。
- 接收方完成处理后删除原消息；需要反馈时新建消息，并用 `reply_to` 指向原 `id`。
- 内容必须能说明主要状况，但不可写流水账。

### `<history>` 规则

- 只放用户确认结束后的任务压缩摘要。
- 每条 `summary` 不超过 120 个字符。
- 最多保留最近 9 条；超出时删除最旧条目。
- 历史是当前仓库的简短 Git 可追溯记录，不等于长期会话记忆。

### 禁止写入

- 完整日志、长报错、完整 diff、长代码、无关过程记录。
- 密钥、Token、密码、私密配置。
- 未验证的推测、未经确认的需求。
- 已完成且对后续角色无价值的过程信息。

复杂内容需要时，放到 `docs/bbs/<topic>.md`；BBS 只记录结论和路径。任务归档后默认删除该详细文件，只有用户明确要求保留为项目文档时才保留。

## 写入与交接

用户可用：

```text
/bbs write
给测试 Agent 留一条交接
把这个风险写入 BBS
```

优先用脚本写入，由它自动生成 `id`（`m-YYYYMMDD-NN`）、追加消息并守住 7 条上限和 500 字软约束，避免手改 markdown 出错：

```bash
python3 scripts/bbs.py add --root . \
  --from 开发 --to 测试 --type handoff \
  --summary "登录异常分支已实现，请验证错误凭证、重复提交和超时。" \
  --files "src/auth/*, tests/auth/*" --verify "npm test -- auth"
```

写入时：

1. 只写最小必要字段；`--summary` 必填。可选字段：`--files / --verify / --need / --risk / --decision / --detail / --reply-to`。
2. 指定 `--from / --to / --type`；不能确定接收方时写 `--to user`，不要猜。
3. 需要详细依据时，先创建 `docs/bbs/<topic>.md`，再用 `--detail` 引用它。
4. 脚本已自动只输出短摘要，例如：`已写入 BBS：m-20260625-01（开发 → 测试，handoff）。`；若脚本报「7 条已满」或「summary 过长」，按提示先与用户确认，不要绕过。

## 结束与归档

用户可用 `/done` 或自然语言“任务结束”。

### 第一步：生成拟归档摘要

1. 读取 BBS（若不存在，说明没有可归档协作板）。
2. 检查 `<message>`：只要还有未处理消息，就列出它们并说明**暂不能归档**；不要擅自删除。
3. 若 `<message>` 为空，根据当前任务已验证的结果生成一条不超过 120 字的拟归档摘要。
4. 只展示摘要并等待用户明确回复“确认归档”或等价指令。

示例：

```text
拟归档：登录异常处理完成；已验证错误凭证、重复提交和超时，未发现遗留问题。
回复“确认归档”后写入 history 并完成清理。
```

### 第二步：确认后执行

仅在用户明确确认后：

```bash
python3 scripts/bbs.py archive --root . --summary "拟归档摘要"
```

脚本会再次确认 `<message>` 为空，写入 `<history>`、保留最近 9 条，并确保 `<message>` 为空。

如用户明确要求放弃当前消息，可先执行：

```bash
python3 scripts/bbs.py clear --root . --yes
```

然后重新执行 `/done` 流程。清理只会清空 `<message>`，不会删除 `<history>`。

## 快捷命令

```text
/role <角色名>    切换当前 session 角色
/bbs init         初始化 docs/bbs/lite-team-bbs.md
/bbs read         读取当前 BBS
/bbs write        写入一条必要交接消息
/done             生成拟归档摘要，等待用户确认
```

自然语言与命令完全等价。

## 输出约束

- 默认短输出，只报告已改、已验证、待确认或 BBS 写入结果。
- 不刷屏，不复述整个协作板，除非用户要求。
- 不确定时写给正确接收方或 `user`，不要自行脑补。
- 未验证就不能宣称完成。
