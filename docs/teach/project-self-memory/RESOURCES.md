# project-self-memory 资源

本主题的第一手来源全部在本仓库内。外部资料只用于解释通用工程概念，不用于描述 PSM 的行为。

## Knowledge

- [SKILL.md](../../../skills/project-self-memory/SKILL.md) — 行为规范。自动流程边界、`-g`/`-r`/`-t`/`-c` 的职责、讨论轮次规则、评测计划输出格式的唯一权威。用途：判断「Agent 应当做什么」。
- [cli-contract.md](../../../skills/project-self-memory/references/cli-contract.md) — 命令行为与 JSON 输出形状。用途：判断「CLI 返回什么、退出码是什么」。
- [memory-format.md](../../../skills/project-self-memory/references/memory-format.md) — 记录格式、单行契约、标签派生规则、版本字段。用途：判断「一条记忆长什么样」。
- [expression-contract.md](../../../skills/project-self-memory/references/expression-contract.md) — STE 表达契约。宿主在写入前如何改写候选正文。用途：判断「为什么我写的正文被改了」。
- [curation-rules.md](../../../skills/project-self-memory/references/curation-rules.md) — 策展判定规则。用途：判断「`-g`/`-r`/`-t` 各自挑出哪些候选」。
- [grouping-rules.md](../../../skills/project-self-memory/references/grouping-rules.md) — 旧 `group` 的兼容语义。用途：维护旧分组库时读。
- [migration-rules.md](../../../skills/project-self-memory/references/migration-rules.md) — `legacy scan` / `legacy migrate` 流程与计划形状。用途：把 `self-memory/` 迁到活动目录时读。
- [viewer.md](../../../skills/project-self-memory/references/viewer.md) — 查看器的 HTTP 契约与安全模型。用途：判断「查看器能做什么、不能做什么」。
- [reference-host.md](../../../skills/project-self-memory/references/reference-host.md) — `MemorySession` 接入示例。用途：宿主开发者读；普通用户读「自动流程为什么会产生候选」这一段即可。
- [根 README 的 project-self-memory 速查](../../../README.md#project-self-memory) — 参数表与调用示例的唯一维护处。用途：查参数名。
- cache 规格与 5 张决策卡（本地工单区 `.scratch/psm-cache/`，按仓库约定不入版本库）— 用途：查「为什么是这样设计」的原始理由。
- `scripts/memory-cache.mjs`、`scripts/memory.mjs`、`scripts/memory-session.mjs` — 实现真相。文档与代码冲突时以代码为准。

## Wisdom (Communities)

本主题没有推荐的外部社区。PSM 是本仓库的私有 skill，没有公开的讨论社区。

替代路径是本仓库内部的可验证实践：

- `tests/memory-cache.test.mjs` — cache 行为的 20 条黑盒用例，每条带中文 GWT 注释与「防回归」说明。用途：把「为什么这样设计」读成「曾经出过什么问题」。
- `skills/project-self-memory/README.md` 的「四类 ID」与「评分不是单纯计数」两节 — 账本语义的浓缩说明。用途：理解为什么同一次重试不重复计分。

## Gaps

- 没有官方的 IDE 插件或 GUI 客户端使用经验可参考。
- 没有多用户协作场景的公开经验；PSM 的并发模型目前只在本仓库的测试里被验证过。
