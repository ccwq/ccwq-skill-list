<!-- <psm-store version="1" next_id="0008" group_dimension="" /> -->
<!-- <psm id="0001" type="pitfall" status="active" positive="0" negative="0" created_at="2026-08-11T15:41:36Z" last_scored_at="" /> -->
`.env` 的反斜杠续行必须在执行 `KEY=value` 校验前合并物理行。对逗号分隔的清单，续行处仍需保留分隔符，例如 `aria-filedown,\` 后接下一行；否则会拼成错误的单个名称（如 `aria-filedowndeep-investigation`）。

<!-- <psm id="0002" type="experience" status="active" positive="0" negative="0" created_at="2026-08-11T15:42:08Z" last_scored_at="" /> -->
修改 `scripts/sync-main-skill-manifest.mjs` 的 `.env` 解析行为时，应通过 CLI 与临时 `.env` fixture 验证，而不是直接测试内部函数。反斜杠续行回归至少覆盖普通 LF，以及多段续行配合 Windows CRLF 的场景。

<!-- <psm id="0003" type="pitfall" status="active" positive="0" negative="0" created_at="2026-08-11T15:42:38Z" last_scored_at="" /> -->
Windows PowerShell 5.1 将含中文或 emoji 的 YAML 通过 here-string 管道传给原生命令（例如 `@''...''@ | python`）时，默认 `$OutputEncoding=US-ASCII` 会在 Python 接收前把非 ASCII 字符替换为 `?`，导致 Git 提交信息不可恢复地损坏。执行 git-up 的提交计划时，应优先以 UTF-8 文件传入 `commit_plan.py --plan-file`；不要依赖 `[Console]::OutputEncoding`，它不控制 PowerShell 到原生命令的对象管道编码。

<!-- <psm id="0004" type="fact" status="active" positive="0" negative="0" created_at="2026-08-11T16:01:36Z" last_scored_at="" /> -->
本项目新增 `agent-human-debug` Skill 时，规范名称以其 `SKILL.md` frontmatter 的 `name` 为准，目录放在 `skills/agent-human-debug`；根 README 需要同时更新“可用 Skill”索引和“参数速查”，`.claude-plugin/marketplace.json` 需要增加对应的 `name`、`source`、`description`、`version`、`category` 条目。2026-08-12 已验证该 Skill 的 `SKILL.md`、`README.md`、reference 文件存在，marketplace JSON 可解析，`npm run sync:main-skills` 执行成功。

<!-- <psm id="0005" type="fact" status="active" positive="0" negative="0" created_at="2026-08-12T01:38:16Z" last_scored_at="" /> -->
`agent-human-debug` 的未知环境首轮固定返回 CMD 与 Bash 两段只读探测脚本，不返回 PowerShell。脚本采集最小环境基线，使用 `run_id` 和随机临时文件保留处理后结果；剪切板失败时输出终端并保留临时文件。`REDACTION_REVIEW` 不自动写剪切板，改为终端和临时文件输出并提示人工审查。收到结果后固定进入“二次检查敏感信息 → 确认环境基线 → 只读调查 → 规划 → $grill-me 需求讨论”。2026-08-12 已用 Git Bash 真实运行 Bash 段（退出码 0）并用 cmd.exe 真实运行 CMD 段（退出码 0）；`git diff --check`、README 链接和 marketplace JSON 校验均通过。

<!-- <psm id="0006" type="fact" status="active" positive="0" negative="0" created_at="2026-08-12T02:44:19Z" last_scored_at="" /> -->
在 `E:\project\self.project\ccwq-skill-list` 纳入一个完整外部 Skill 包时，保留其 `SKILL.md` 和被该文件相对引用的辅助文档/agent 元数据；同步根 `README.md` 的“可用 Skill”索引与“参数速查”，并在 `.claude-plugin/marketplace.json` 添加 `name`、`source`、`description`、`version`、`category`。2026-08-12 导入 `tutor-man` 时，源 zip 与 `skills/tutor-man` 五个文件 SHA-256 一致，README 链接、Marketplace JSON、`npm run check:main-skills` 和 `git diff --check` 均通过；未将该 Skill 加入 `.env` 的 `MAIN_LIST`，因此不改变主分组。

<!-- <psm id="0007" type="fact" status="active" positive="0" negative="0" created_at="2026-08-12T02:52:31Z" last_scored_at="" /> -->
`tutor-man` 的默认输出语言为中文；代码、命令、API 名称、文件路径和必要技术术语保留原文，用户明确指定其他语言时切换。该规则位于 `skills/tutor-man/SKILL.md` 的 Language 段，并同步到根 `README.md` 参数速查注意事项及 `.claude-plugin/marketplace.json` 描述。2026-08-12 已通过规则断言、Marketplace JSON 解析、`npm run check:main-skills` 和 `git diff --check`。

