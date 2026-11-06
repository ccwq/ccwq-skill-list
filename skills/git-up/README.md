# Git-up

根据工作区改动生成提交计划。执行时只暂存计划中明确列出的文件。

其他功能包括：

- 提交后 push。
- 委派一个子智能体完成提交。
- 增量维护 `.gitignore`。

简单、安全的单提交任务使用 `-pc/-pcP` 时，自动采用快车道。


## 安装

从插件市场安装（需先把本仓库加为 marketplace）：

```text
/plugin install git-up --marketplace ccwq/ccwq-skill-list
```

或用 skills CLI 安装：

```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list --agent claude-code --skill git-up
```


## 快速开始

```text
$git-up -p                         # 只生成 YAML 提交计划
$git-up -pc                        # 规划后立即提交
$git-up -s 仅提交 skills/git-up    # 完全委派一个子智能体规划并提交
$git-up -i                         # 增量维护 .gitignore
```

[查看参数与模式](../../README.md#git-up)。

## 提交边界

每个计划步骤都列出明确路径。文件级计划仅暂存所列路径；语义计划按补丁和路径边界执行。

相关文件按模块和依赖关系拆分。每次提交都可以独立回滚。

暂存区已有内容时，快速执行器会停止。此保护防止计划外改动混入提交。

必须先确认暂存内容的归属，再重新生成或执行计划。不得扩大文件范围以绕过保护。

## 语义拆分提交

默认规划按文件拆分。显式指定 `-d` / `--deep` 后，才分析并按需使用语义模式；每一步用 `changes` 声明补丁，同一文件可以进入多个提交。deep 没有混合改动时也可使用文件级计划。

语义模式的执行器按依赖顺序逐步把补丁写入 index，不改动工作区。执行结束后，它比较最终 HEAD 与执行前保存的目标工作区。不一致时返回失败，不报告成功。

语义模式不支持二进制补丁、重命名和复制格式。这些情况必须显式失败。

完整格式、补丁模式、错误码和快车道回退条件见 [references/semantic-commit.md](references/semantic-commit.md)。

## 选择规划深度

默认按文件拆分，`-p` 先输出完整 YAML 供审阅；`-c` 可在同一会话执行最近计划。显式使用 `-d` 或 `--deep` 才进行深度语义规划；`-d` 不授权提交。`-g/--grilling` 逐问审查计划，等待用户回答后继续，`--modify` 按直接反馈调整计划；二者继承当前深度，不提交。旧 `--discuss` 兼容 grilling，旧 `-z` 仍兼容默认轻量行为。

Grilling 的审查范围、提问轮次与停止条件见 [references/grilling.md](references/grilling.md)。本技能自足，不要求安装外部 grilling skill。

规划加提交可在符合条件时使用快车道。默认轻量规划放宽文件数与跨模块的规划质量检查，但保留 Git 安全检查；deep 不放宽。具体路由、兼容性与执行约束见 [SKILL.md](SKILL.md)，参数速查见[根 README](../../README.md#git-up)。

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
node skills/git-up/scripts/plan_context.mjs --cwd .
node skills/git-up/scripts/commit_plan.mjs --help
node skills/git-up/scripts/inspect_fast_path.mjs --cwd . --ez-fast
node skills/git-up/scripts/split_patch.mjs --diff .scratch/git-up/full.patch --out .scratch/git-up/patches
node skills/git-up/scripts/gitignore_manager.mjs --cwd . --dry-run
```

`plan_context.mjs` 一次返回规划所需的全部输入：改动文件清单（已跟踪与未跟踪分组）、工作区与暂存区的 diff 统计、当前分支、以及最近若干条提交标题。提交信息惯例从 `recent_subjects` 推断，不必再单独翻 `git log`。

以上 inspect 示例及以下 commit 示例适用于默认轻量计划；deep 时移除 `--ez-fast`。Windows PowerShell 5.1 提交包含中文或 emoji 的计划时，使用 UTF-8 `--plan-file`，不要直接把 here-string 通过管道传给 Node：

```powershell
[IO.File]::WriteAllText($planFile, $plan, [Text.UTF8Encoding]::new($false))
node skills/git-up/scripts/commit_plan.mjs commit --cwd . --plan-file $planFile --ez-fast
```

完整 YAML 格式见 [references/plan-format.md](references/plan-format.md)。快车道判定、语义拆分、提交消息规范、push 重试规则及委派契约见 [SKILL.md](SKILL.md)。
