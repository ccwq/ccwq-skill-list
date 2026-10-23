# Project Self-Memory

`project-self-memory` 把经过筛选的项目结论保存到 `.project-self-memory/`。

任务通过 `MemorySession` 加载相关记忆。它也负责保存结论和记录记忆的使用结果。

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

[查看调用与参数](../../README.md#project-self-memory)。JSON 输出和退出语义见 [CLI contract](references/cli-contract.md)。

必须通过 CLI 或查看器读写活动文件。不得直接编辑 `.project-self-memory/` 内的文件。

人工浏览或修改正文/类型/状态时，可以启动随 `init` 部署的紧凑查看器：

```bash
node <project-root>/.project-self-memory/view-memoery.js
```

它只监听 127.0.0.1 并输出带 `#token=` 的地址，并自动用系统默认浏览器打开（`--no-open` 可禁止）。写入与 CLI 共用锁、备份与乐观并发。部署、HTTP 契约与安全模型见 [viewer.md](references/viewer.md)。

`self-memory/` 是只读 legacy 来源，只能通过 `legacy` 命令迁移，不能直接编辑。

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
- `evidence.jsonl` 是只追加的审计账本。它保存评分和使用结果，不保存记忆正文或自由文本证据。
- `MemorySession` 是自动记忆操作的唯一入口。该入口不向 Agent 暴露原始存储、CLI、shell 或文件系统能力。

## 四类 ID

| 字段 | 含义 | 示例 |
| --- | --- | --- |
| `record_id` | 一条记忆的稳定编号；内容更新后仍不变 | `0001` |
| `record_version` | `id`、类型、状态、分组和正文的 SHA-256 指纹；内容变更会得到新版本 | `a1b2…`（64 位） |
| `task_id` | 产生证据的任务编号；宿主可传入，未传入时按任务上下文稳定生成 | `task-8f…` |
| `event_id` | 一张证据收据的唯一键 | `auto-8f…`、`manual-UUID` |

自动事件 ID 由以下字段稳定生成：

`task_id + record_id + record_version + kind + source`

同一任务重试会得到相同 ID。审计账本返回 `duplicate`，不重复计分。

手工 CLI 操作默认生成新的 `manual-UUID`；需要重放同一次手工操作时，可显式传入相同 `--event-id`。

## 评分不是单纯计数

旧接口仍可读取 `positive`、`negative` 和 `last_scored_at`。这些字段由审计账本计算，不再是原始事实来源。

支持的事件包括人工正负反馈、直接应用成功/失败、仍然有效、review 候选、迁移、投影修复和合并谱系。事件绑定记录版本：旧正文的成功历史不会自动转移到新正文。

自动正向证据必须同时满足：

1. 记录已由当前 `MemorySession` 加载；
2. `task_id` 等于当前任务；
3. `record_version` 等于当前加载版本；
4. 宿主确认记忆被直接采用且具有直接结果。

无法直接归因的失败会成为 `review_candidate`，不会自动扣分。Agent 自述的 evidence 或 conclusion 不能触发自动评分或自动保存。

## 上下文控制

自动加载不再等于 `read --all`。推荐的 `relevant` 模式按下面顺序选择：

1. 校验配置、记忆库和审计账本。
   任一项无法确认有效时，停止自动加载。
2. 排除 `review` 和 `disabled`；
3. 根据任务的关键词、类型和分组筛选相关性；
4. 应用可信度和新鲜度条件；
5. 排序并限制单一分组占用；
6. 在 `max_records` 与 `max_context_tokens` 内截断；
7. 生成不含正文的筛选审计记录（selection audit）。

`auto_load: false` 优先级最高：不会读取记忆正文，也不会将 sentinel 或其他记忆内容放入最终 payload。

`all` 只用于显式维护或诊断。普通任务使用 `relevant`。

配置缺失、非法或损坏时，不得静默回退到 `all`。

## 接入宿主

每个 Agent 任务创建一个 `MemorySession`，以 `beginTask()` 开始、以 `endTask()` 结束。宿主负责：

- 传入任务上下文和显式保存候选；
- 捕获最终 payload、capabilities、selection audit 和任务结果；
- 仅在存在直接、可归因的宿主结果时提交自动 evidence；
- 不向 Agent 暴露 shell、filesystem 或 raw memory CLI。

可运行示例见 [Reference host adapter](references/reference-host.md)。它是参考接入，不代表任何生产宿主已经采用该 Skill。

## 安装与验证

测试覆盖以下范围：

- 源目录入口与安装副本的 Junction 入口。
- 审计账本的幂等性和记录版本绑定。
- 自动行为开关与 token 预算。
- 安装隔离与运行时基准测试。

必须在一次性副本中验证安装。不得把以下运行产物写回源 Skill 目录：

- `.project-self-memory` 与 `.agents`。
- lockfile 与 PID 文件。
- port 与 stream 文件。

具体流程见 [Disposable-copy 安装卫生](references/install-hygiene.md)。

## 设计边界

- 不自动删除、合并、改写正文或改变记录状态。
- 不把高分当作当前真相；历史记忆仍需要现场验证。
- 不在第一版引入向量库、远程 embedding 或云端同步。
- 不试图 sandbox 整个 Agent；真实宿主仍需管理它授予的能力。

