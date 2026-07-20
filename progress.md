# lite-team 第一轮改进进度

## 2026-07-20 Gemini Mirror 安全融合

- Completed：读取 HANDOFF、Skill、脚本、README 和 marketplace；未调用浏览器或访问目标站点。
- Completed：5 轮 Grill 确认正式入库、删除双重确认、唯一账号面板核验、离线 mock 测试和审计脱敏。
- In progress：实施脚本和文档护栏，随后进行离线验证与敏感信息复查。
- Verified：`node --test` 3/3 通过；两个 Node 模块语法检查与 marketplace JSON 检查通过；缺少 `--confirm-delete` 的脚本调用退出码为 1，且错误发生在 browser runner 初始化前。
- Note：首次敏感词扫描把参数解析变量 `token` 误报为凭据，已切换为赋值型凭据规则后复查。
- Verified：赋值型凭据扫描无命中；补正了 `SKILL.md` 示例中的两处旧 session 字面量；最终约束与文档一致。

## 2026-06-25

- Started：用户要求一步一步实现，边做边学习，同时提升 `skills/lite-team/`。
- Completed Phase 0：建立 `task_plan.md`、`findings.md`、`progress.md`。
- Completed Phase 1：修正 `bbs.py` 顶层 help 中的旧 BBS 路径，并用 `python .\skills\lite-team\scripts\bbs.py --help` 验证通过。
- Note：`init --help` 不显示子命令摘要；argparse 的子命令 help 摘要需要看父 parser `--help`。
- Completed Phase 2：`bbs.py init` 改为从 `assets/bbs.template.md` 读取模板，并用字节级比较验证生成文件与模板一致。
- Note：第一次验证用文本比较失败，原因是 Windows 文本写入产生 CRLF；已改为 bytes 读写解决。
- Completed Phase 3：同步 `skills/lite-team/README.md` 与 `CHANGELOG.md`，明确 `assets/bbs.template.md` 是 init 实际使用的模板来源。
- Completed Phase 4：运行沙盒回归，验证 help/init/add/status/clear/archive 正常；`init` 后模板字节级一致；marketplace JSON 合法。
- Note：第一次完整流程后比较模板失败是预期行为，因为 archive 写入了 history；模板一致性应在 init 后立即验证。
- Synced：`.claude-plugin/marketplace.json` 中 lite-team 版本更新到 `1.1.1`。
- Verified：从非仓库目录 `%TEMP%` 调用绝对路径 `bbs.py`，`init/status` 正常，生成文件与模板字节级一致。
- Verified：在临时项目中模拟安装到 `.claude/skills/lite-team` 后，通过安装态脚本完成 `init/add/status`，BBS 包含写入消息。
- Verified：README/SKILL/assets/scripts/references/roles 关键路径均存在。
- SkillOpt：确认 `skillopt_sleep dry-run` 支持 `--target-skill-path` 和 `--tasks-file`，可读取 `skills/lite-team/SKILL.md` 作为 live skill。
- SkillOpt：`--backend mock` + seeded tasks 跑通，输出 `live skill`、`using 2 seeded tasks`、`baseline=1.0/candidate=1.0`；该结果只证明管线可运行，不证明 lite-team 语义质量。
- SkillOpt：`--backend claude` 可运行，但自定义 rule/rubric/exact tasks 均得到 `baseline=0.0`；直接用相同 Skill + Task 形态调用 `claude -p` 能产出正确 `bbs.py add --from 开发 --to 测试 --type handoff` 操作方式，说明当前阻塞点更像 SkillOpt-Sleep 任务评分/响应捕获适配，而非 lite-team 行为本身。
- Limitation：SkillOpt-Sleep 公共 CLI 当前只暴露 `mock/claude/codex/copilot` backend，不能直接使用已配置的 OpenAI-compatible endpoint `http://127.0.0.1:8310/v1`。
