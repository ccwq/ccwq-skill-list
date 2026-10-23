# Reference host adapter

`scripts/reference-host.mjs` 是一个最小的 host-owned 集成示例。它真实创建并调用 `MemorySession` 的 `beginTask()` / `endTask()`，返回生命周期 payload、capabilities、audit 和结束结果。

```powershell
node scripts/reference-host.mjs --project-root C:\path\to\project
node scripts/reference-host.mjs --project-root C:\path\to\project --auto-load
```

默认 `auto_load=false`、`auto_save=false`、`auto_rate=false`，适合 disposable smoke test。`--auto-load` 只打开受策略控制的上下文加载；它不会把 raw memory、CLI、shell 或 filesystem 能力授予 Agent。该 adapter 是参考实现，不表示任何生产 host 已接入。

`projectRoot` 与 adapter 脚本位置相互独立：CLI 路径始终由 adapter 自身解析，因此从 source Skill、Subject Junction 或任意 `cwd` 启动都使用同一 runtime。

## 计量会话与首次召回提醒

**单任务实例 ≠ 计量会话。** 宿主为每个任务新建 `MemorySession` 且不共享状态时，每个实例都是独立计量会话：每个任务的首次非空召回都会各自执行一次检查。需要「整个宿主会话只提醒一次」的多任务宿主，必须显式把同一个 `recallState` 对象传给每个实例的 `constructor`（`new MemorySession({ recallState, ... })`）；该状态只承载首次检查结果（`checked`/`estimated_tokens`/`exceeded`），不承载任务权限、候选或评分证据。不要以相同 task_id、项目路径或哈希推断会话连续性，也不要跨进程持久化该状态。

首次检查的触发条件与输出：

- 只在检索筛选、排序与预算限制完成、**成功交付非空 `memoryContext`** 后执行；空召回、`auto_load` 关闭（含 fail-closed）与加载失败不消耗检查机会。成功边界是 payload 交给调用方或 `agent.run`；Agent 执行失败不撤销检查。
- 估算算法：对最终交付文本整体计算 UTF-16 长度 ÷ 3 向上取整（含记录前缀与记录间分隔；不是按条取整累加）。结果是估算值，不是目标模型 tokenizer 的精确计数。
- 估算严格大于 37,000（十进制）时，audit 通道出现 `action: "recall-usage"`、`outcome: "warning"` 的非阻断事件，`payload.recallUsage.warning.message` 携带含估算值、阈值与「压缩或复盘记忆」建议的提醒文本。**宿主必须把该提醒展示给用户**（写入会话输出，不是只留在日志）；当前任务继续。提醒不是压缩或复盘授权；用户另行要求时走人工策展入口。
- 原始 CLI `read` 保持只读输出契约，不承担会话提醒；纯提示词式宿主（未接入 MemorySession）没有首次提醒能力。

