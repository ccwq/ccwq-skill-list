# agent-human-debug

一个跨平台的人机协作故障诊断 Skill：Agent 负责最小化取证与证据分析，人类以低成本执行单段命令；结果先脱敏，再优先复制到剪切板回传。

## 使用方式

将整个目录放入支持 Skills 的目录，或把 `SKILL.md` 作为技能入口加载。

核心能力：

- 环境优先：识别 OS、Shell、执行位置、权限、工具与剪切板能力后才选 probe
- 最小 probe：environment、filesystem、process、network、application、configuration、logs、security 八类证据采集
- 统一 `debug_report`：`SUMMARY`、`EVIDENCE`、`NEXT` 三段，便于直接回传和继续分析
- 自动脱敏与 clipboard-first 回传；剪切板失败时降级为控制台 + 系统临时文件
- Node.js / Python / Bash / CMD / PowerShell 等已存在运行时的适配
- 动态主线/支线轮次管理
- 截图补充证据
- 修改风险分级和授权
- 子智能体内部并行调查/复核
- 验证后才允许宣布问题已解决

按需参考：

- [环境识别与执行适配](references/environment-detection.md)
- [Probe 模块契约](references/probe-contract.md)
- [debug_report 协议](references/debug-report-protocol.md)
- [诊断输出脱敏规范](references/sanitization.md)
- [平台脚本与剪切板模式](references/platform-and-script-patterns.md)
