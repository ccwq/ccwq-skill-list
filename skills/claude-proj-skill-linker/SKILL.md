---
name: claude-proj-skill-linker
description: 项目级 skill 接入与链接整理：把 .agents/skills 下的项目 skill 通过目录链接接入项目 .claude/skills、迁移 .claude 中的实体 skill 到 .agents、整理链接入口时使用。跨平台（Linux/macOS 符号链接、Windows junction），CLI 提供稳定的 JSON/退出码契约并在 apply 后独立验收入口。只操作指定项目，绝不写入全局 ~/.claude。用户确认前只用预览模式。
---

# 项目 Skill 链接器

`.agents/skills/<name>` 是 skill 本体的规范位置；`.claude/skills/<name>` 是让本会话发现该 skill 的链接入口。所有平台判定、恢复和验收逻辑由脚本执行，不要用 shell 命令手工替代。

## 1. 确定项目与范围

向用户确认或从当前请求推断项目根目录与 skill 名称。未指定项目时用当前工作目录；未指定名称时处理全部 skill。完成标准：项目根目录和范围（全量或名称列表）明确，且不是全局 `~/.claude`、`~/.agents` 或文件系统根。

## 2. 只读预览

```bash
node <skill-dir>/scripts/link-skills.mjs --project-root <root> [--skill <name>...]
```

完成标准：进程 exit 0，stdout 是唯一的 JSON 报告，且报告包含 `digest`、`actionCount` 和每项 action（`link`、`move-and-link` 或跳过原因）；stderr 为空。记下 `digest` 与 action 清单，向用户呈现外部依赖说明。此步骤零写入。

## 3. 用户确认后执行

只有用户明确确认清单后才继续。参数必须与预览时完全一致（包括 `--skill` 范围），并附加确认到的摘要：

```bash
node <skill-dir>/scripts/link-skills.mjs --project-root <root> [--skill <name>...] --apply --expect <digest>
```

状态在预览后变化时报 `STALE`：回到第 2 步重新预览并再次确认，不得沿用旧 digest。摘要只代表预览时的行动计划（根、范围、每项判定与链接目标），不校验 skill 内容是否被编辑；apply 仍会对实际入口执行独立验收。中途失败时脚本停止后续写入：当前项尝试自动恢复，已成功项保留；恢复本身也可能失败（如 `RESTORE_BLOCKED`）。把错误码、失败项与实际数据位置原样报告给用户，等待指示。

## 4. 成功判定与 CLI 输出契约

一次 apply 只有同时满足以下三要素才算成功：

1. **退出码**：进程 exit 0。
2. **stdout 报告**：stdout 输出一个合法 JSON 报告；apply 报告含 `results`，且成功项均为 `status: ok`。
3. **文件系统状态**：每个成功项的入口是 Junction/SymbolicLink，realpath 指向 canonical source，并且经入口可读 `SKILL.md`；apply 后再次 preview 对应 `actionCount` 应为 0、备注为 `already linked correctly`。

CLI 契约固定如下：成功 preview/apply 为 stdout JSON + exit 0；`--help` 为 stdout 帮助文本 + exit 0；参数错误为 stderr 用法说明 + exit 2；运行时、漂移或验收失败为 stderr `ERROR <code>: <message>` + 非 0。失败诊断可能同时带失败 skill 与 `Stopped before` 信息；不要把非零退出当作成功报告。被其他模块 import 时，缺少 `argv[1]` 是预期的 embedding 场景，不会自动进入 CLI 主流程。

完成标准：已核对退出码、stdout/stderr 契约和每个成功入口的三项文件系统验收；失败时已记录错误码、失败项、恢复结果和残留位置。

## 边界

- 新 skill 或整理需求出现时加载本 skill；写入永远等待用户确认。
- 项目根与 `.agents`、`.claude` 及其 `skills` 容器必须是实体目录；链接容器被拒绝，防止写入被重定向到项目外。单个源 skill 允许是指向外部目录的只读链接。
- 删除入口用 bash `rm` 或 `cmd /c rmdir`；PowerShell NonInteractive 下 `Remove-Item` 删目录链接会失败。
- 本 skill 不执行 Git 命令；移动 Git 已跟踪的目录仍会改变工作区状态。入口是否被 Git 忽略按目标项目的忽略规则处理。
