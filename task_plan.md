# lite-team 教学式第一轮改进计划

## Goal

边做边讲，使用小步迭代提升 `skills/lite-team/` 的可信度和可维护性。

## Phases

### Phase 0：建立持久化计划

Status: complete

- 创建 `task_plan.md`、`findings.md`、`progress.md`。
- 记录本轮目标、发现与执行进度。

### Phase 1：修正 bbs.py help 路径

Status: complete

- 修正 `skills/lite-team/scripts/bbs.py` 中 `init` 子命令仍写旧路径 `docs/bbs/bbs.md` 的问题。
- 验证 `python .\skills\lite-team\scripts\bbs.py --help` 不再出现旧路径。
- 发现：`argparse` 的子命令 help 摘要显示在父 parser `--help` 中，`init --help` 只显示 init 自己的 options。

### Phase 2：收敛 BBS 模板来源

Status: complete

- 让 `cmd_init()` 从 `skills/lite-team/assets/bbs.template.md` 读取模板。
- 停止使用脚本内联 `TEMPLATE` 常量，避免双份维护。
- 模板缺失时显式报错。
- 验证：沙盒初始化成功，`status` 正常，生成文件与模板文件字节级一致。
- 发现：Windows 上 `write_text()` 会把 LF 写成 CRLF；改用 `read_bytes()` / `write_bytes()` 保持模板字节级一致。

### Phase 3：同步 lite-team 文档

Status: complete

- 同步 `skills/lite-team/README.md` 的文件说明。
- 在 `skills/lite-team/CHANGELOG.md` 记录本轮修复。
- 说明 `assets/bbs.template.md` 是 `init` 实际读取的模板来源。

### Phase 4：验证入口与回归

Status: complete

- 检查根 README：命令/路径未变化，无需扩写，继续保持索引和参数速查职责。
- 同步 `.claude-plugin/marketplace.json` 中 `lite-team` 版本到 `1.1.1`。
- 运行 lite-team 脚本沙盒回归：help、init、add、status、clear、archive 均通过。
- 校验 `.claude-plugin/marketplace.json` 是合法 JSON。
- 发现：模板字节一致性应在 `init` 后立即验证；完整归档流程会写入 history，最终文件不应再等于空模板。
- 补充验证：从非仓库目录调用绝对路径 `bbs.py` 仍可定位安装目录下的 `assets/bbs.template.md`。
- 补充验证：临时项目级安装态 `.claude/skills/lite-team` 下，脚本 `init/add/status` 正常。
- 补充验证：lite-team README 提到的关键文件路径均真实存在。

## Decisions

- 本轮不新增 `read/remove/validate` 子命令，先把现有接口做可信。
- 本轮不全局重构 marketplace 的 `pluginRoot/source` 体系，避免扩大范围。
- 根 README 只做索引和参数速查，不写长篇教程。

## Errors Encountered

| Error | Attempt | Resolution |
|---|---|---|
| 无 | - | - |
