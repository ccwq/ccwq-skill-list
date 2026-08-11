# Subagent Router

将可并行、需要独立复核或需要模型路由的工作拆给临时原生 Codex Worker。主线程始终保留用户沟通、授权、集成与最终验收；它不会创建持久的 `.codex/agents/*.toml` 角色文件。

## 适用场景

- 多个相互独立的调查、实现或审查分支。
- 需要隔离上下文、明确文件所有权或独立验证的改动。
- 需要在成本、平衡和质量策略之间选择 Worker 组合的任务。

简单、单线程即可完成的工作不应为了使用 Worker 而路由。

## 快速开始

```text
$subagent-router -t 调查登录失败的前后端原因，并独立复核修复方案
$subagent-router -gs 讨论支付模块迁移的边界、风险和验收方式
$subagent-router -l 并行梳理项目结构、检查缺陷并分析测试覆盖
```

根 [README](../../README.md) 保留完整参数速查；这里说明运行模型与边界。

## 一次授权流程

Router 的状态依次为：讨论中 → 待授权 → 执行中 → 已完成。

讨论阶段只做提问、分析和只读核验。条件明确后，主线程会给出执行预览，列明每个角色的目标、模型与推理强度、权限与文件范围、验证方式以及可派生额度。只有去除首尾空白后恰好为 `okok` 的一条用户消息，才能授权当前预览。

模型、范围、权限、验证、上下文、并发或派生额度发生实质变化时，旧授权立即失效，必须重新预览并再次收到 `okok`。

## 模型与嵌套边界

- `-l` 偏成本，`-t` 偏平衡，`-s` 偏质量；它们是策略而非模型锁。
- Luna 只能作为 Terra 或 Sol 的叶节点 Worker，不能派生子 Worker。
- Terra 与 Sol 只能在已授权的派生额度、深度和并发范围内继续嵌套。
- 默认最多 5 个临时 Worker；写入任务必须拥有互不冲突的文件或模块。

Worker 的完成声明不是验收。主线程会独立检查范围、证据、测试、冲突、回滚材料和遗留风险。

## 本地检查

修改 Router 或其协议后，运行：

```powershell
node skills/subagent-router/scripts/verify-router-skill.mjs
```

`route-decision.mjs` 用于预览派生合法性，`validate-worker-contract.mjs` 用于检查任务包和 Worker 回传。详细协议见 [SKILL.md](SKILL.md) 与 `references/` 下的路由、授权、失败和 Worker 契约文档。
