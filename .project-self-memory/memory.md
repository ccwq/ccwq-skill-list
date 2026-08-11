<!-- <psm-store version="1" next_id="0005" group_dimension="" /> -->
<!-- <psm id="0001" type="pitfall" status="active" positive="0" negative="0" created_at="2026-08-11T15:41:36Z" last_scored_at="" /> -->
`.env` 的反斜杠续行必须在执行 `KEY=value` 校验前合并物理行。对逗号分隔的清单，续行处仍需保留分隔符，例如 `aria-filedown,\` 后接下一行；否则会拼成错误的单个名称（如 `aria-filedowndeep-investigation`）。

<!-- <psm id="0002" type="experience" status="active" positive="0" negative="0" created_at="2026-08-11T15:42:08Z" last_scored_at="" /> -->
修改 `scripts/sync-main-skill-manifest.mjs` 的 `.env` 解析行为时，应通过 CLI 与临时 `.env` fixture 验证，而不是直接测试内部函数。反斜杠续行回归至少覆盖普通 LF，以及多段续行配合 Windows CRLF 的场景。

<!-- <psm id="0003" type="pitfall" status="active" positive="0" negative="0" created_at="2026-08-11T15:42:38Z" last_scored_at="" /> -->
Windows PowerShell 5.1 将含中文或 emoji 的 YAML 通过 here-string 管道传给原生命令（例如 `@''...''@ | python`）时，默认 `$OutputEncoding=US-ASCII` 会在 Python 接收前把非 ASCII 字符替换为 `?`，导致 Git 提交信息不可恢复地损坏。执行 git-up 的提交计划时，应优先以 UTF-8 文件传入 `commit_plan.py --plan-file`；不要依赖 `[Console]::OutputEncoding`，它不控制 PowerShell 到原生命令的对象管道编码。

<!-- <psm id="0004" type="fact" status="active" positive="0" negative="0" created_at="2026-08-11T16:01:36Z" last_scored_at="" /> -->
本项目新增 `agent-human-debug` Skill 时，规范名称以其 `SKILL.md` frontmatter 的 `name` 为准，目录放在 `skills/agent-human-debug`；根 README 需要同时更新“可用 Skill”索引和“参数速查”，`.claude-plugin/marketplace.json` 需要增加对应的 `name`、`source`、`description`、`version`、`category` 条目。2026-08-12 已验证该 Skill 的 `SKILL.md`、`README.md`、reference 文件存在，marketplace JSON 可解析，`npm run sync:main-skills` 执行成功。

