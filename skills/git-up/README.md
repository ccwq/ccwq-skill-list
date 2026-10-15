# Git-up

根据工作区改动生成提交计划。执行时只暂存计划中明确列出的文件。

其他功能包括：

- 提交后 push。
- 委派一个子智能体完成提交。
- 增量维护 `.gitignore`。

简单、安全的单提交任务使用 `-pc/-pcP` 时，自动采用快车道。

## 快速开始

```text
$git-up -p                         # 只生成 YAML 提交计划
$git-up -pc                        # 规划后立即提交
$git-up -s 仅提交 skills/git-up    # 完全委派一个子智能体规划并提交
$git-up -i                         # 增量维护 .gitignore
```

[查看参数与模式](../../README.md#git-up)。

## 提交边界

计划依据 Git 状态和改动规模生成。每个步骤都列出明确路径。执行时只对这些路径运行 `git add`。

相关文件按模块和依赖关系拆分。每次提交都可以独立回滚。

暂存区已有内容时，快速执行器会停止。此保护防止计划外改动混入提交。

必须先确认暂存内容的归属，再重新生成或执行计划。不得扩大文件范围以绕过保护。

## 模式选择

根据任务选择模式：

- 先审阅拆分边界，再决定是否提交：`-p` 只规划，`-c` 执行本会话内最近的计划，二者必须在同一会话。
- 追求一步到位时用 `-pc`。最多 5 个文件、单一模块且无风险信号时，只返回紧凑计划摘要；不满足条件则回退完整 YAML。
- 需要 push 时用 `-cP` / `-pcP`：仅在提交成功后 push，且只对网络或传输失败重试。
- 委派给别人执行时用 `-s` / `-sP`：父线程只创建一个子智能体并等待结果。
- 只想整理忽略规则时用 `-i`：不读取也不改动暂存区。

## 安全与失败语义

`--push` 必须与提交模式组合。工具不自动创建 upstream。

遇到以下错误时，工具直接报告，不重试：

- 认证失败。
- 权限不足。
- non-fast-forward。
- 保护分支拒绝。

`-s` 后的文字限定提交范围。子智能体无法满足范围要求时，必须停止。父线程不得改为自行提交。

`.gitignore` 默认不会添加 `.env`；清理 Git-up 管理区块需要先预览，再以 `--clean --apply` 明确确认。

## 脚本入口

```powershell
python skills/git-up/scripts/commit_plan.py --help
python skills/git-up/scripts/gitignore_manager.py --cwd . --dry-run
```

Windows PowerShell 5.1 提交包含中文或 emoji 的计划时，使用 UTF-8 `--plan-file`，不要直接把 here-string 通过管道传给 Python：

```powershell
[IO.File]::WriteAllText($planFile, $plan, [Text.UTF8Encoding]::new($false))
python skills/git-up/scripts/commit_plan.py commit --cwd . --plan-file $planFile
```

完整 YAML 格式、快车道判定、提交消息规范、push 重试规则及委派契约见 [SKILL.md](SKILL.md)。
