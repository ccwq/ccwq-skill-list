---
name: project-self-memory
description: 维护项目级、可自进化的结论记忆 / Maintain a project-local, self-evolving conclusion memory. 在调查、诊断、实现、验证、维护或确立长期项目决策等非简单仓库任务中使用；开始时读取项目记忆，结束时沉淀已验证事实、长期决策和可复现避坑 / Use for nontrivial repository work such as investigation, diagnosis, implementation, verification, maintenance, or durable decisions; read project memory first and capture verified reusable conclusions at completion.
---

# 项目自记忆

维护一份小而当前的**记忆**，让下一次项目任务更快、更稳。这份记忆绑定单个仓库，不是任务流水。

## 确认项目边界

1. 解析本技能所在目录；仅当其位于 `<project-root>/.agents/skills/project-self-memory/` 时有效。
2. 从该目录推导 `<project-root>`，并将 `<project-root>/self-memory/memory.md` 作为唯一经验存储。
3. 若技能位于其他位置，在读写记忆前停止，并报告迁移目标：`<project-root>/.agents/skills/project-self-memory/`。

完成条件：skill 所在位置及唯一可写的记忆路径均无歧义。

## 在项目任务中使用记忆

开始非简单项目任务时，若 `self-memory/memory.md` 存在则读取它。只应用与当前任务相关的结论；文件代表当前项目事实，不能替代现场验证。

最终回复前执行一次结论扫描，只捕获以下内容：

- 已直接验证的项目事实；
- 用户确认的长期项目决策或约束；
- 已复现且具备明确规避方式的避坑结论。

以可公开的最小事实记录结论，省略凭据、密钥、个人数据和机器易失快照。无法安全脱敏的有用结论，改在回复中说明而不写入记忆。

完成条件：任务中每一项合格结论均已归为“直接写入”“等待确认”或“超出范围”。

## 处理 `-m` 和 `--memory`

将 `-m <内容>` 与 `--memory <内容>` 视为显式沉淀请求。参数必须携带非空内容；缺失时说明正确调用形式，不从上下文推断载荷。

显式载荷只绕过常规的价值筛选，仍遵守本技能的证据、范围、冲突、去重和敏感信息规则。

完成条件：载荷已安全地形成记忆候选，或调用方收到无法存储的明确原因。

## 更新当前结论

创建或更新 `memory.md` 前，阅读[记忆契约](references/memory-contract.md)，保留可见来源头并采用其中的主题与标签格式。

满足以下任一证据锚点时直接更新文件：

- 用户明确确立长期决策；
- 项目权威文件直接陈述该结论；
- 已直接观察并成功验证代码、配置或运行时行为。

对于证据含糊、当前结论竞争、未经验证的推断或单次故障症状，展示候选并等待用户确认。

合并重复项。仅当更强证据确立替代结论时，替换或移除过时结论。保留无关的用户编辑，历史恢复交由版本控制承担。

每次直接更新后，简要报告新增、合并、替换和移除的结论数。环境可执行 Python 时，在交付前运行内置校验器：

```powershell
python .agents/skills/project-self-memory/scripts/validate_memory.py --project-root . --skill-path .agents/skills/project-self-memory --require-memory
```

完成条件：记忆保持当前、带来源标识、结构有效，且回复已报告变更。
