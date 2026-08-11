# Reference host adapter

`scripts/reference-host.mjs` 是一个最小的 host-owned 集成示例。它真实创建并调用 `MemorySession` 的 `beginTask()` / `endTask()`，返回生命周期 payload、capabilities、audit 和结束结果。

```powershell
node scripts/reference-host.mjs --project-root C:\path\to\project
node scripts/reference-host.mjs --project-root C:\path\to\project --auto-load
```

默认 `auto_load=false`、`auto_save=false`、`auto_rate=false`，适合 disposable smoke test。`--auto-load` 只打开受策略控制的上下文加载；它不会把 raw memory、CLI、shell 或 filesystem 能力授予 Agent。该 adapter 是参考实现，不表示任何生产 host 已接入。

`projectRoot` 与 adapter 脚本位置相互独立：CLI 路径始终由 adapter 自身解析，因此从 source Skill、Subject Junction 或任意 `cwd` 启动都使用同一 runtime。

