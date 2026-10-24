# Project Self-Memory

`project-self-memory` 把经过筛选的项目结论保存到 `.project-self-memory/`。

任务通过 `MemorySession` 加载相关记忆。它也负责保存结论和记录记忆的使用结果。

## 快速开始

从目标项目根目录调用 Skill 中的 CLI。`<skill-path>` 是本 Skill 自身目录（`SKILL.md` 所在处）：Codex 装在 `.agents/skills/project-self-memory/`，Claude Code 装在 `.claude/skills/project-self-memory/`。

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
node <skill-path>/scripts/memory.mjs cache list
```

Skill 层的显式调用：Codex 用 `$project-self-memory`，Claude Code 用 `/project-self-memory`。

```text
$project-self-memory -g      # 盘点经验
$project-self-memory -r      # 评价本次用过的记忆
$project-self-memory -t      # 清理过时结论
$project-self-memory -c      # 处理暂存区候选（候选入库的唯一入口）
$project-self-memory -l      # 显式读取
```

[查看调用与参数](../../README.md#project-self-memory)。JSON 输出和退出语义见 [CLI contract](references/cli-contract.md)。

必须通过 CLI 或查看器读写活动文件。分类标准也由 CLI 显式应用；人工可编辑独立计划文件，不直接修改 `.project-self-memory/` 内的文件。

人工浏览或修改正文/类型/状态时，可以启动随 `init` 部署的紧凑查看器：

```bash
node <project-root>/.project-self-memory/view-memoery.js
```

它只监听 127.0.0.1 并输出带 `#token=` 的地址，并自动用系统默认浏览器打开。关闭自动打开等启动参数见[根 README](../../README.md#project-self-memory)。写入与 CLI 共用锁、备份与乐观并发。部署、HTTP 契约与安全模型见 [viewer.md](references/viewer.md)。

`self-memory/` 是只读 legacy 来源，只能通过 `legacy` 命令迁移，不能直接编辑。

## 它如何工作

```text
memory.md（记忆正文）
        +
evidence.jsonl（无正文的证据收据）
        +
cache.jsonl（跨会话待处理候选）
        ↓
MemorySession
        ↓
相关性 → 可信度/新鲜度 → 多样性 → token 预算
        ↓
最终 Agent payload
```

- `memory.md` 保存人可读的记忆正文和稳定记录 ID。
- `evidence.jsonl` 是只追加的审计账本。它保存评分和使用结果，不保存记忆正文或自由文本证据。
- `cache.jsonl` 是自动流程的暂存区。自动保存与自动评分只把候选写在这里，不直接写记忆库；候选由 `-c/--cache-write` 逐条确认后入库。该文件由 Git 忽略。
- `MemorySession` 是自动记忆操作的唯一入口。该入口不向 Agent 暴露原始存储、CLI、shell 或文件系统能力。
- 可选 `tags.json` 提供项目自己的分类标准；读取时从正文派生多标签，不修改正文、记录版本或评分证据。

## 候选入库（cache）

自动流程不再直接落库：任务结束时只把结论与投票写进 `cache.jsonl`，跨会话保留。`-c/--cache-write` 读取待处理候选，按目标记录分组逐条询问，改写类必须展示「原正文 vs 新正文」diff 后由用户确认，再逐条写入记忆库。目标记录在暂存后被改动时，该候选标记为失效并拒绝直接落库，需基于现状重新评估。`cache prune` 清理已处理与已失效条目；`pending` 候选没有 TTL，不会自动过期。

## 可选主题标签

新分类使用标签，已有 `group` 保持兼容，不自动迁移。每条记忆可有多个标签；分类标准缺失不影响记忆读写、自动加载或评分。

- 零配置识别正文行首 `[key=value]`，也支持 `[key=v1,v2]` 拆出多个标签；缺少或空白 `tags.json` 时仍生效。
- 项目 taxonomy 用 `any`/`all` 关键词规则匹配正文，采用大小写不敏感的字面量子串，不支持正则或词边界保证；应选精确项目词。人工通过 override 修正单条记忆，每条最多 8 个标签。
- `tags suggest` 只输出已有前缀与重复标识词的词频候选，不是 AI 分类，不联网，也不自动采纳。人工审核其 `taxonomy` 对象，补充项目规则后再显式应用；分类标准与 override 写入都需针对具体操作授权，自动保存和评分不会修改它们。
- 标签参与只读筛选与归因观测，**不参与检索 rank 排序**（本规格冻结语义）；无标签记录不因此被过滤，零相关记录不能仅靠标签入选，多样性仍按旧 `group` 分桶。
- 查看器支持多选标签任一匹配、按首标签分组，标签只读；标签文件损坏仅关闭全部标签并报告 warning，不让正常库进入只读模式。

格式、排序、降级与持久化边界见 [memory-format.md](references/memory-format.md)；调用示例与参数统一见[根 README](../../README.md#project-self-memory)，输出见 [CLI contract](references/cli-contract.md)。

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

支持的事件包括人工正负反馈、直接应用成功/失败、仍然有效、迁移、投影修复和合并谱系。事件绑定记录版本：旧正文的成功历史不会自动转移到新正文。

自动正向证据必须同时满足：

1. 记录已由当前 `MemorySession` 加载；
2. `task_id` 等于当前任务；
3. `record_version` 等于当前加载版本；
4. 宿主确认记忆被直接采用且具有直接结果。

无法直接归因的失败不产生投票候选，既不自动扣分也不落库；这类结果留在会话里，进入 `-r` 讨论。Agent 自述的 evidence 或 conclusion 不能触发自动评分或自动保存。

## 上下文控制

自动加载不再等于 `read --all`。推荐的 `relevant` 模式按下面顺序选择：

1. 校验配置、记忆库和审计账本。
   任一项无法确认有效时，停止自动加载。
2. 排除 `review` 和 `disabled`；
3. 根据任务关键词、类型和旧分组计算基础相关性，对精确匹配的任务标签增加排序权重；
4. 应用可信度和新鲜度条件；
5. 排序并限制单一分组占用；
6. 在 `max_records` 与 `max_context_tokens` 内截断；
7. 生成不含正文的筛选审计记录（selection audit）。

`auto_load: false` 优先级最高：不会读取记忆正文，也不会将 sentinel 或其他记忆内容放入最终 payload。

`all` 只用于显式维护或诊断。普通任务使用 `relevant`。

配置缺失、非法或损坏时，不得静默回退到 `all`。

## 接入宿主

每个 Agent 任务创建一个 `MemorySession`，以 `beginTask()` 开始、以 `endTask()` 结束。宿主负责：

- 传入任务上下文和显式保存候选；保存前按[内置表达契约](references/expression-contract.md)把候选正文改写为紧凑单行；
- 捕获最终 payload、capabilities、selection audit 和任务结果；首次非空召回超过 37,000 估算 token 时把 `recallUsage` 提醒展示给用户；
- 多任务宿主显式共享 `recallState` 对象以界定同一计量会话（详见 [Reference host adapter](references/reference-host.md)）；
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
- 新写入的正文必须符合单行契约（宿主按[内置表达契约](references/expression-contract.md)改写，CLI 确定性校验）；历史多行记录保持可读，不迁移、不批量改写。
- 每个计量会话首次成功交付非空记忆时估算 token；严格大于 37,000 时发出非阻断提醒，任务继续，提醒不是整理授权。
- 不把高分当作当前真相；历史记忆仍需要现场验证。
- 不在第一版引入向量库、远程 embedding 或云端同步。
- 不试图 sandbox 整个 Agent；真实宿主仍需管理它授予的能力。

