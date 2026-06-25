# lite-team — 轻量多 Agent 协作 Skill

一个可移植、无后台服务的开发协作 Skill。它用项目内的 `docs/bbs/lite-team-bbs.md` 实现不同 Agent / session 的按需交接；不自动编排、不自动读取、不建立长期会话记忆。

> 脚本需 Python 3（≥3.8）；部分系统 `python` 仍指向 Python 2，请统一用 `python3`。

## 最快使用

1. 将整个 `lite-team` 文件夹安装到 Agent Skill 目录。
2. 在项目根目录执行：

```bash
python3 <skill目录>/scripts/bbs.py init --root .
```

3. 在 Agent 中使用：

```text
/role 开发
给测试 Agent 留一条交接：登录异常分支已完成，需要验证错误凭证、重复提交和超时。

/role 测试
读取协作板。
```

4. 消息全部处理并删除后：

```text
/done
```

Agent 会先生成不超过 120 字的拟归档摘要。你回复“确认归档”后，才会写入 `<history>` 并清空 `<message>`。

## 安装位置

### Codex

- 项目级：`<repo>/.agents/skills/lite-team/`
- 个人级：`~/.agents/skills/lite-team/`

### Claude Code

- 项目级：`<repo>/.claude/skills/lite-team/`
- 个人级：`~/.claude/skills/lite-team/`

将压缩包解压后，把整个目录复制到上面的任一位置。两种工具都以目录中的 `SKILL.md` 为入口。

## 文件说明

```text
lite-team/
├─ SKILL.md                 # 交给 Agent 的核心规则
├─ README.md                # 安装与使用说明
├─ assets/
│  └─ bbs.template.md       # init 初始化协作板时使用的模板
├─ references/
│  └─ roles/                # 内置角色人设（产品 / 开发 / 测试）
│     ├─ product.md
│     ├─ dev.md
│     └─ test.md
└─ scripts/
   └─ bbs.py                # 按模板初始化，并提供写入、状态、清空、归档辅助脚本
```

运行时生成的项目文件：

```text
docs/bbs/lite-team-bbs.md             # 正常提交 Git
```

## BBS 最小示例

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
</history>
```

## 脚本命令

在项目根目录执行，替换 `<skill目录>` 为实际路径：

```bash
# 创建协作板
python3 <skill目录>/scripts/bbs.py init --root .

# 写入一条交接消息（自动生成 id、守住 7 条上限和 500 字软约束）
python3 <skill目录>/scripts/bbs.py add --root . \
  --from 开发 --to 测试 --type handoff \
  --summary "登录异常分支已实现，请验证错误凭证、重复提交和超时。" \
  --files "src/auth/*, tests/auth/*" --verify "npm test -- auth"

# 查看数量
python3 <skill目录>/scripts/bbs.py status --root .

# 清空当前消息，保留历史；需要显式确认
python3 <skill目录>/scripts/bbs.py clear --root . --yes

# 用户确认归档后执行；要求 <message> 已为空
python3 <skill目录>/scripts/bbs.py archive --root . --summary "登录异常处理完成；已验证关键异常路径，未发现遗留问题。"
```

## 约束摘要

- 不自动读取 BBS；仅用户或主 Agent 明确要求时读。
- `message` 最多 7 条；处理后删除，不保留流水账。
- `history` 最多 9 条；每条摘要不超过 120 字。
- BBS 可提交 Git，因此不要写入密钥、Token、密码或敏感配置。
- 复杂说明放 `docs/bbs/<topic>.md`；任务结束默认删除，只有用户明确要求才保留。
- 默认手动串行操作；不处理多人并发编辑冲突。
