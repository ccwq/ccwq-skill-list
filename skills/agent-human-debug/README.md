# agent-human-debug

一个用于 Agent 与人类进行技术联调、故障诊断、验证和修复协调的 Skill。

## 使用方式

将整个目录放入支持 Skills 的目录，或把 `SKILL.md` 作为技能入口加载。

核心能力：

- 动态主线/支线轮次管理
- 用户本地执行脚本
- Node.js / Python / Bash / CMD / PowerShell
- 自动脱敏
- 自动复制剪切板
- 剪切板失败时控制台 + 系统临时文件降级
- 截图补充证据
- 修改风险分级和授权
- 子智能体内部并行调查/复核
- 验证后才允许宣布问题已解决

脚本平台细节位于：

`references/platform-and-script-patterns.md`
