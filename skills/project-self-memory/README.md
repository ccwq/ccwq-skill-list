# Project Self-Memory

`project-self-memory` 是项目级记忆的运行时：它把经过策展的结论保存到项目根目录的 `.project-self-memory/`，并在每个 Agent 任务中通过 `MemorySession` 安全地加载、保存和记录使用结果。

它解决的不是“记住更多”，而是“只把当前任务值得看的记忆放进上下文”。

## 它如何工作

```text
memory.md（记忆正文）
        +
evidence.jsonl（无正文的证据收据）
        ↓
MemorySession
        ↓
相关性 → 可信度/新鲜度 → 多样性 → token 预算
        ↓
最终 Agent payload
```

- `memory.md` 保存人可读的记忆正文和稳定记录 ID。
- `evidence.jsonl` 是 append-only ledger，保存评分和使用结果的审计事件，不保存记忆正文或自由文本证据。
- `MemorySession` 是唯一自动生命周期 seam：Agent 不会得到 raw store、raw CLI、shell 或 filesystem 能力。

## 四类 ID

| 字段 | 含义 | 示例 |
| --- | --- | --- |
| `record_id` | 一条记忆的稳定编号；内容更新后仍不变 | `0001` |
| `record_version` | `id`、类型、状态、分组和正文的 SHA-256 指纹；内容变更会得到新版本 | `a1b2…`（64 位） |
| `task_id` | 产生证据的任务编号；宿主可传入，未传入时按任务上下文稳定生成 | `task-8f…` |
| `event_id` | 一张证据收据的唯一键 | `auto-8f…`、`manual-UUID` |

自动事件的 ID 基于 `task_id + record_id + record_version + kind + source` 稳定生成。同一任务重试会得到同一个 ID，因此 ledger 会返回 `duplicate`，不会重复计分。

手工 CLI 操作默认生成新的 `manual-UUID`；需要重放同一次手工操作时，可显式传入相同 `--event-id`。

## 评分不是单纯计数

旧接口中的 `positive`、`negative` 和 `last_scored_at` 仍可读取，但它们是 ledger 的派生投影，不再是事实来源。

支持的事件包括人工正负反馈、直接应用成功/失败、仍然有效、review 候选、迁移、投影修复和合并谱系。事件绑定记录版本：旧正文的成功历史不会自动转移到新正文。

自动正向证据必须同时满足：

1. 记录已由当前 `MemorySession` 加载；
2. `task_id` 等于当前任务；
3. `record_version` 等于当前加载版本；
4. 宿主确认记忆被直接采用且具有直接结果。

无法直接归因的失败会成为 `review_candidate`，不会自动扣分。Agent 自述的 evidence 或 conclusion 不能触发自动评分或自动保存。

## 上下文控制

自动加载不再等于 `read --all`。推荐的 `relevant` 模式按下面顺序选择：

1. 校验配置、store 和 ledger；任何不确定状态均 fail-closed；
2. 排除 `review` 和 `disabled`；
3. 根据任务的关键词、类型和分组筛选相关性；
4. 应用可信度和新鲜度条件；
5. 排序并限制单一分组占用；
6. 在 `max_records` 与 `max_context_tokens` 内截断；
7. 生成不含正文的 selection audit。

`auto_load: false` 优先级最高：不会读取记忆正文，也不会将 sentinel 或其他记忆内容放入最终 payload。

`all` 仅适用于显式维护/诊断场景；普通任务应使用 `relevant`。缺失、非法或损坏的配置不会静默回退到 `all`。

## 快速开始

从目标项目根目录调用 Skill 中的 CLI：

```bash
node <skill-path>/scripts/memory.mjs init
node <skill-path>/scripts/memory.mjs config validate
node <skill-path>/scripts/memory.mjs validate
node <skill-path>/scripts/memory.mjs read
```

常用人工操作：

```bash
node <skill-path>/scripts/memory.mjs add --type fact --content-file conclusion.txt
node <skill-path>/scripts/memory.mjs score 0001 +1
node <skill-path>/scripts/memory.mjs evidence inspect --record-id 0001
```

完整参数、JSON 输出和退出语义见 [CLI contract](references/cli-contract.md)。不要直接编辑 `.project-self-memory/` 内的活动文件；所有读写通过 CLI 完成。

## 接入宿主

每个 Agent 任务创建一个 `MemorySession`，以 `beginTask()` 开始、以 `endTask()` 结束。宿主负责：

- 传入任务上下文和显式保存候选；
- 捕获最终 payload、capabilities、selection audit 和任务结果；
- 仅在存在直接、可归因的宿主结果时提交自动 evidence；
- 不向 Agent 暴露 shell、filesystem 或 raw memory CLI。

可运行示例见 [Reference host adapter](references/reference-host.md)。它是参考接入，不代表任何生产宿主已经采用该 Skill。

## 安装与验证

测试覆盖 source 入口、subject Junction 入口、ledger 幂等、版本绑定、false 控制、token 预算、安装卫生和 runtime benchmark。安装验证必须在 disposable copy 中运行，不能把 `.project-self-memory`、`.agents`、lockfile、PID、port 或 stream 文件写回 source Skill。

具体流程见 [Disposable-copy 安装卫生](references/install-hygiene.md)。

## 设计边界

- 不自动删除、合并、改写正文或改变记录状态。
- 不把高分当作当前真相；历史记忆仍需要现场验证。
- 不在第一版引入向量库、远程 embedding 或云端同步。
- 不试图 sandbox 整个 Agent；真实宿主仍需管理它授予的能力。

