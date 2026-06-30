# lite-team 第一轮改进发现记录

## 已确认事实

- `skills/lite-team/scripts/bbs.py` 的 `bbs_path()` 返回 `docs/bbs/lite-team-bbs.md`。
- 同一脚本的 `init` 子命令 help 仍写 `docs/bbs/bbs.md`，属于接口文案漂移。
- `skills/lite-team/scripts/bbs.py` 内联了 `TEMPLATE` 常量。
- `skills/lite-team/assets/bbs.template.md` 也保存了同样的空 BBS 模板，存在双份维护风险。
- Windows 上 `Path.write_text()` 会将 LF 模板写成 CRLF，若要证明“初始化内容等于模板文件”，应使用 `read_bytes()` / `write_bytes()` 保持字节级一致。
- `skills/lite-team/README.md` 已说明运行时文件是 `docs/bbs/lite-team-bbs.md`。
- `.claude-plugin/marketplace.json` 中已有 `lite-team` 条目。

## 本轮优先级

1. 先修旧路径 help 文案。
2. 再把模板收敛到 `assets/bbs.template.md`。
3. 最后同步文档和验证。

## SkillOpt 验证发现

- `skillopt_sleep dry-run --help` 暴露了 `--target-skill-path` 与 `--tasks-file`，可用来把 `skills/lite-team/SKILL.md` 作为 live skill 输入 SkillOpt-Sleep。
- `skillopt_sleep` 公共 CLI 的 backend choices 是 `mock/claude/codex/copilot`，不包含 OpenAI-compatible endpoint；源码中虽有 Azure/OpenAI backend 类，但当前 CLI choice 未暴露 `openai_chat` 或本地 `/v1` 兼容端点。
- `mock` backend 能证明 SkillOpt-Sleep 管线读取目标 skill 和任务文件，但 mock 不是语义验证；它不能证明 lite-team 真能指导 Agent。
- `claude` backend 能运行，但 dry-run JSON 摘要不暴露 replay response；自定义 tasks 得到 0 分时，难以仅凭 SkillOpt-Sleep 输出判断是 skill 失败还是任务评分设计不适配。
- 诊断性 `claude -p` 直接运行同类 Skill + Task prompt 时，能输出正确的 `python3 scripts/bbs.py add --root . --from 开发 --to 测试 --type handoff ...` 操作方式。

