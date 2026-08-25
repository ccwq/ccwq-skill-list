---
name: engineering-method-selector
description: 显式调用的工程方法论选择器：根据目标、上下文、阶段、产物、质量属性与风险，诊断问题并组合推荐可验证的工程方法。
disable-model-invocation: true
---

# Engineering Method Selector

这是一个**用户显式调用**的工程决策辅助 Skill。它提供建议、约束和证据要求，不替用户拍板，也不把术语解释当成完成。

## 1. 建立决策输入

从用户请求和当前仓库事实中提取：`Goal`、`Context`、`Constraints`、`Risk`、`Stage`、`Artifact`、`Quality Attribute`。缺失信息只有在会改变推荐时才追问；否则标记为 `unknown`，不要臆造。

将问题归入一个主活动：`requirement`、`design`、`coding`、`testing`、`debug`、`review`、`operation`、`ai_engineering` 或 `decision`。一个问题可以有次级活动，但只保留一个主问题分类。

**完成条件：** 已明确主活动、当前工程产物、主要质量属性和至少一个风险/约束；未知项已显式标注。

## 2. 沿工程链路诊断

按以下链路处理，而不是从方法名反推问题：

`User Context → Problem Classification → Engineering Activity → Artifact → Quality Attribute → Method Selection → Constraint Injection → Evidence Validation`

先判断用户正在改善什么产物，再判断产物需要什么质量属性，最后选择方法。若产物尚未形成，优先推荐能形成产物的方法（例如 User Story、Acceptance Criteria、ADR、Test Case、Incident Report）。

读取 [method-cards.yaml](./references/method-cards.yaml) 查找候选卡；需要判断分类、适用阶段或组合关系时读取 [taxonomy.md](./references/taxonomy.md)。

**完成条件：** 候选方法都能说明“解决哪个问题、作用于哪个产物、改善哪个质量属性”。

## 3. 组合推荐并注入最小约束

推荐一个最小有效组合，而不是堆砌术语：通常包含一个主方法、零到两个配套方法和一个验证方法。只有当方法之间存在明确产物依赖时才组合，例如：

- 复杂新增功能：`User Story + Acceptance Criteria + ADR + Test Strategy`
- 线上故障：`Incident Response + Hypothesis-Driven Debugging + Postmortem`
- 高风险架构取舍：`ADR + Trade-off Matrix + Benchmark/Experiment`
- AI Agent 任务：`Task Contract + Plan-Execute-Verify + Context Handoff`

从候选卡的 `constraints` 注入最小必要约束；从 `avoid` 选择一个最相关的 Anti-pattern 提醒。约束应可执行、可检查，并与风险相称。不要因为方法流行就推荐它。

**完成条件：** 每个推荐方法都有选择原因、最小约束、收益、风险和避免事项；组合没有重复职责。

## 4. 设计证据验证

每个建议必须绑定至少一种 Evidence：`test_result`、`benchmark`、`metric`、`log`、`experiment`、`review` 或 `production_signal`。验证应回答“什么结果会证实或推翻这次选择”。没有证据时输出 `validation_pending`，不要把计划写成事实。

置信度分为：

- `high`：输入完整，方法与产物/质量属性高度匹配，已有证据。
- `medium`：匹配合理，但存在一项会影响结果的未知或尚未验证的假设。
- `low`：问题边界、约束或证据不足；先建议澄清或小实验。

**完成条件：** 验证方式包含可观察对象、通过/失败信号和验证时机；置信度与证据一致。

## 输出格式

默认用中文，保留方法名和字段名英文。始终输出以下工程诊断卡；信息不足时保留 `unknown`，不要省略字段：

```markdown
## 工程诊断卡

- 问题分类: <主分类，可附次分类>
- 识别信号: <来自用户上下文的事实；区分推断>
- 工程阶段: <stage>
- 目标产物: <artifact>
- 关键质量属性: <quality attributes>
- 推荐方法:
  1. **<name>**（<type>）— <为什么现在需要>
  2. **<name>**（<type>）— <与上一项的产物依赖；没有则省略>
- 置信度: <high|medium|low>；依据：<证据/未知>
- 最小必要约束:
  - <可执行约束>
- 收益: <预期收益>
- 风险与代价: <引入的成本、误用风险或剩余风险>
- 验证:
  - Evidence: <类型>
  - 观察对象: <测试/指标/日志/评审产物>
  - 通过信号: <可观察标准>
  - 失败或升级条件: <何时换方法、补证据或停止>
- Avoid: <最相关的 anti-pattern>
- 下一步: <一个最小动作>
```

## 边界与回退

- 用户只问概念定义时，仍先确认是否要做工程选择；若只是学习，给出简短定义并说明未启动诊断卡。
- 用户要求直接改代码时，本 Skill 只提供决策卡；实际修改遵循宿主的编码流程。
- 不把 Scrum、OKR、组织管理或商业战略作为默认推荐范围；只有当它直接影响软件工程产物时才标记为上下文约束。
- 当多个方法同样适配时，给出首选和一个条件性替代，并指出改变结论的条件。
- 当风险涉及安全、合规、数据破坏或生产变更时，提高证据门槛，明确需要人工审批；不要用方法卡替代专业审查。

完成条件：输出工程诊断卡，且推荐、约束、风险和验证彼此一致；若用户要求继续执行，先把卡中的“下一步”转成用户可确认的执行计划。
