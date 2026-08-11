# Git-up

用于分析工作区改动、生成可执行提交计划，并以显式文件列表完成提交。它还支持受控 push、子智能体完全委派和增量维护 `.gitignore`。

## 快速开始

```text
$git-up -p                         # 只生成 YAML 提交计划
$git-up -pc                        # 规划后立即提交
$git-up -s 仅提交 skills/git-up    # 完全委派一个子智能体规划并提交
$git-up -i                         # 增量维护 .gitignore
```

根 [README](../../README.md) 是参数、简写和模式的唯一速查来源；本页聚焦使用边界。

## 提交边界

计划基于 Git 状态和改动规模生成。每个步骤都列出明确路径，执行时只会 `git add` 这些路径；相关文件会按模块和依赖关系拆分为可独立回滚的提交。

执行前若暂存区已有内容，快速执行器会停止，防止把计划外改动混入提交。此时应先确认这些暂存内容的归属，再重新生成或执行计划；不要通过扩大文件范围绕过保护。

## 模式选择

- `-p`：只规划；适合先审阅拆分边界。
- `-c`：执行本会话内最近计划。
- `-pc`：免二次确认的规划加提交。
- `-cP` / `-pcP`：仅在提交成功后 push；只对网络或传输失败重试。
- `-s` / `-sP`：父线程只创建一个子智能体并等待结果。跟随的自然语言是硬提交边界，子智能体不能满足时会停止。
- `-i`：仅维护 `.gitignore`，不读取或改动暂存区。

## 安全与失败语义

`--push` 不能单独使用，也不会自动创建 upstream。认证、权限、非 fast-forward 或保护分支等错误会直接报告，不会重试。

`.gitignore` 默认不会添加 `.env`；清理 Git-up 管理区块需要先预览，再以 `--clean --apply` 明确确认。委派模式下，父线程不接管失败后的 Git 操作。

## 脚本入口

```powershell
python skills/git-up/scripts/commit_plan.py --help
python skills/git-up/scripts/gitignore_manager.py --cwd . --dry-run
```

完整 YAML 格式、提交消息规范、push 重试规则及委派契约见 [SKILL.md](SKILL.md)。
