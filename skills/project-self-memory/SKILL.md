---
name: project-self-memory
description: 维护项目级、可自进化的结论记忆。用于非简单仓库调查、诊断、实现、验证、维护或确定长期项目决策；开始时加载相关记忆，结束时用 CLI 保存已验证、可复用的事实、约束、决策和避坑。用户要求盘点经验时进入逐问 Grilling，要求整理或清理时进入 Trim。
---

# 项目自记忆

本 Skill 把项目经验保存在 `<project-root>/.project-self-memory/`，由 Node CLI 独占读写。`self-memory/` 是只读 legacy 来源；不要直接编辑任一活动文件。

## 开始任务

1. 在项目根目录运行 `node <skill-path>/scripts/memory.mjs init`；它只在缺失时创建 `config.yaml` 与 `memory.md`。
2. 执行 `validate`。配置不合法时关闭自动行为，先报告错误；结构化库损坏时不执行写操作。
3. `auto_load: true` 时，先用 `read`；大型库可先查标签目录再精读，已有分组库仍可按旧 `group` 读取。标签是可选线索，无标签不阻断任务。只将相关内容作为线索，现场状态仍要验证。调用与参数统一见[根 README](../../README.md#project-self-memory)。

## CLI 工作流

唯一入口是：

```text
node scripts/memory.mjs <command> [options]
```

## Host adapter

需要把生命周期接入宿主时，可先使用 [Reference host adapter](references/reference-host.md)。`scripts/reference-host.mjs` 真实调用 `MemorySession` 并返回最终 payload、capabilities、audit 和 end result；它是可运行的参考 seam，不代表生产系统已经接入。安装与验证应遵循 [Disposable-copy 安装卫生](references/install-hygiene.md)。

每个计量会话的首次成功交付非空 `memoryContext` 时，`MemorySession` 对最终交付文本整体估算一次 token（UTF-16 长度除以 3 向上取整）。估算严格大于 37,000 时，通过 audit 通道发出非阻断 `recall-usage` warning，payload 上同时有 `recallUsage` 结构化结果；宿主必须把提醒展示给用户（含估算值、37,000 阈值与「压缩或复盘记忆」建议），当前任务继续，提醒不是整理授权。空召回、`auto_load` 关闭和加载失败不消耗检查机会。默认实例各自独立计量；多任务宿主显式传入同一 `recallState` 对象共享一次检查。原始 CLI `read` 不承担会话提醒。宿主接入细节见 [reference-host.md](references/reference-host.md)。

## 紧凑查看器

`init` 会把自包含单文件查看器部署到 `.project-self-memory/view-memoery.js`。人工浏览或改正文/类型/状态时，优先用它，而不是直接编辑 `memory.md`：

```text
node .project-self-memory/view-memoery.js
```

它只监听 127.0.0.1，输出带 `#token=` 的地址，并自动用系统默认浏览器打开。关闭自动打开等启动参数见[根 README](../../README.md#project-self-memory)。写入走与 CLI 相同的锁、备份、原子替换和乐观并发。部署与升级契约、HTTP 接口和安全模型见 [viewer.md](references/viewer.md)。

正文使用 `--content-file <path>` 或标准输入，避免 shell 转义。常用命令：

```bash
node scripts/memory.mjs init
node scripts/memory.mjs read --type pitfall
node scripts/memory.mjs add --type fact --content-file conclusion.txt
node scripts/memory.mjs score 0001 +1
node scripts/memory.mjs inspect --trim-candidates
```

调用与参数统一见[根 README](../../README.md#project-self-memory)，JSON 输出和退出语义见 [cli-contract.md](references/cli-contract.md)。格式约束见 [memory-format.md](references/memory-format.md)。

## 保存与评分

保存前，宿主必须按[内置表达契约](references/expression-contract.md)把候选正文改写为紧凑单行：一条记录一个可复用结论，一句一个事实或动作，命令、路径、标识符与既有合法前缀保持原文。改写只调整表达，不产生新事实，也不增加保存授权；改写失败（无法保留原意、证据不足或字面量冲突）时跳过该候选并继续任务，不原样保存。CLI 在写入前做确定性校验：新正文去除外围空白后必须单行，不得含标题、列表、代码围栏或 psm 结构标记；历史多行记录保持可读，元数据单独变更不强制重写旧正文。

自动保存仅限目标链结束时的全新、已验证、无冲突且不需要用户取舍的结论。`auto_rate` 只能对有直接正向证据的记录执行一次 `+1`；可归因的失败暂存为 `-1` 候选，无法归因的结果不投票、留在会话里进入 `-r` 讨论。

**自动流程一律不得直接写入记忆库**，只能把候选暂存进 cache。原来的「自动流程不得修订、合并、删除、调分」由这条替代：修订、删除、评分候选现在可以暂存，写入则一律经 `-c` 确认。`config.yaml` 字段名与取值不变，仅语义改为「自动暂存到 cache」。

`-l/--load` 是显式读取：小库可 `read`，大库先 `catalog` 后 `read --group`，无法可靠选择时读取全部 active 记录。任务级 `--no-load/--no-save/--no-rate` 高于会话级覆盖，高于 `config.yaml`，高于默认值；会话级覆盖使用 `--no-load-session/--no-save-session/--no-rate-session`，在目标链结束或明确恢复时失效。明确自然语言要求同样有效。

当前会话临时清单分两类：**落盘 cache 的候选类**（新增、修订、删除、待评分投票）与**只留内存的读取态**（已加载 refid、已声明的任务与会话覆盖）。前者跨会话保留，后者随目标切换或完成时清空。

## 人工策展

`-g/--grilling`：扫描新增、修订、合并、冲突和迁移候选，按下述共用规则逐问收敛。

`-r/--rate`：仅讨论本会话实际使用且有可观察结果、尚未评分的记录，按“建议 +1 / 建议 -1 / 暂不评分”汇总，按下述共用规则讨论；每条每会话最多一次，包括已由 `auto_rate` 暂存过投票的记录。

`-t/--trim`：只处理负分或 `negative >= 3 && negative >= positive` 的候选；可保留、修订、设为 review/disabled 或删除。策展判断详见 [curation-rules.md](references/curation-rules.md)。

`-c/--cache-write`：处理 cache 里的待处理候选，是候选进入记忆库的唯一入口。

### `-c` 的处理流程

1. **读取**：`cache list` 列出 pending 候选，按目标 refid 分组，含失效标记；同一记录的矛盾候选（`+1` 与 `-1` 并存、多条修改）聚成一组，独立新增每条一组，失效候选单独成组。
2. **分批提问**：每批最多 4 组，按“第 n 问／预计约 total 问”标注。失效组展示「目标已变更：原基准 vs 现状」。
3. **选项按风险分级**：
   - 修改类：展示原正文 vs 新正文 diff，选项为**改写后写入 / 丢弃 / 暂缓**，没有「直接写入」——修改必须经用户确认，改写后的正文用 `--content-file` 传入。
   - 新增、删除、`+1`、`-1`：选项为**写入 / 丢弃 / 暂缓**。
   - 失效组：选项为**丢弃 / 基于现状重新评估**。
4. **授权即执行**：逐条明确选择「写入 / 改写后写入」即构成该条写入授权，不二次确认。每条用 `cache apply --id <id> --decision write|discard` 单独处理（改写后写入附带 `--content-file`）。
5. **写后回读**：每条落库后读取该记录展示结果。

没有候选时直接说明，不制造问题或请求空操作授权。中途中断时，已落库的已生效、未处理的留在 cache，下次继续。`cache prune` 清理已处理与已失效条目；`pending` 候选没有 TTL，不会自动过期。

`-g`、`-r`、`-t` 不读取 cache；cache 只由 `-c` 处理，三者职责互不干扰。

### 讨论轮次与结束条件

以下规则适用于人工 `-g`、`-r`、`-c` 及其组合，不改变自动保存和自动评分的既有边界。

- 默认按约 3 轮估计讨论量。问题复杂时，可以展开到 5–9 轮。轮数是预计预算，不是最低轮数或固定流程；结束条件优先于预计轮数。
- 每轮只问一个当前最影响决策的问题，提供推荐、理由、代价和 TUI 式选项。使用“第 n 问／预计约 total 问”，根据回答更新 total。
- 候选结论明确、关键分歧解决、授权范围清楚后，结束讨论。没有候选时直接说明，不制造问题或请求空操作授权。
- 延长讨论时，说明剩余问题及其对决策的影响。预计超过 9 轮时，先汇总剩余事项，让用户选择继续、缩小范围或分批讨论，再按选择推进。
- `-g`、`-r`、`-c` 及其组合共享问题编号、预计总数和未决事项，切换模式不重置进度。评分不固定安排在某一轮，由证据与授权是否充分决定。
- 人工策展写入前必须取得具体操作的明确授权；明确自然语言授权同样有效，不要求精确口令。授权仍覆盖同一操作时不重复确认；候选内容或操作范围变化时，仅对未获授权的变化部分请求授权。认可结论、同意继续讨论或“确认后保存”不等于已经授权写入。
- 结论已收敛但仍有待执行的未授权操作时，停止内容追问，列明具体操作并等待授权。用户明确只讨论、不保存时，报告结论后结束，不继续索要授权。

例如，第 2 轮结论明确且授权清楚，就结束；第 3 轮发现关键冲突，就调整预计总数，而不是按原预算强行结束。

## 主题标签、旧分组与降级

新分类推荐可选的派生多标签：读取时依据项目 `tags.json`、正文行首前缀与人工 override 计算，不写入 `memory.md`，不改变 `record_version` 或评分投影。缺少或空白 taxonomy 仍识别 `[key=value]` 与 `[key=v1,v2]`；taxonomy 损坏时关闭全部标签并报告 warning，其他功能不受此错误阻断。标签参与显式筛选与只读归因观测，**不参与检索 rank 排序**，不因无标签过滤记录。

需要维护分类标准时，先用只读的 `tags show`、`tags suggest`、`tags stats` 核验。建议仅来自前缀与词频，不是 AI、不联网、不自动采纳；人工审阅计划后，再在具体操作授权范围内执行 `tags apply` 或 `tags set`。自动保存/评分不写 taxonomy。格式、字面量匹配、排序与备份边界见 [memory-format.md](references/memory-format.md)；查看器标签只读，支持多选筛选与首标签分组。

旧 `group` 的解析、序列化与哈希语义保持不变，不自动迁移或删除；维护旧分组仍须完整计划显式应用，规则见 [grouping-rules.md](references/grouping-rules.md)。旧自由 Markdown 先 `legacy scan`，再用计划迁移；规则见 [migration-rules.md](references/migration-rules.md)。Node 缺失时不读写记忆，继续业务任务并报告降级。

不得记录凭据、个人数据、易失机器状态或未经验证推断。结构化格式未知或库边界损坏时，停止所有可能扩大损坏的写操作。

## 行为评测计划输出

当任务要求给出行动计划时，先判断项目状态：仅在明确为空或缺少记忆时使用 `init`；已有、重复、待确认或损坏状态不得初始化。损坏状态先 `config validate` 和/或 `diagnose`，并停止写操作。

计划中的每个 `commands` 条目只能是一条直接的 `node scripts/memory.mjs ...` 调用：不要使用 `printf`、管道、变量、命令替换或 shell 条件。需要写入内容时，计划可引用准备好的 `--content-file conclusion.txt`，但 CLI 的子命令与参数必须完整、可识别。

- 配置校验是 `node scripts/memory.mjs config validate`；通用库校验是 `node scripts/memory.mjs validate`。
- 新分类计划先只读核验 `tags show`/`tags suggest`/`tags stats`；分类标准与单条 override 的写入必须已有具体授权。兼容旧分组计划先 `catalog` 再使用 `node scripts/memory.mjs groups show`；在明确确认前绝不出现 `tags apply`、`tags set`、`groups apply`、`merge`、`delete` 或负分 `score`。
- 按 refid 讨论、检查状态或提出评分建议时，先用 `node scripts/memory.mjs inspect <refid>` 核验该记录及其直接证据；确认前只提出 `score +1`/`score -1` 的候选，不把评分命令放入 `commands`。
- 读后写任务必须先给出 `read`，再给出与任务类型一致的 `add --type <type>` 或 `update <id>`；只读任务不得包含写命令。
- 类型以任务用词为准：任务要求保存“经验”时用 `add --type experience`，要求 pitfall/fact/constraint 时保留该精确类型，不要自行改成通用 `fact`。
- 候选入库走 `-c` 流程：先只读 `cache list` 核验待处理候选，再在授权范围内给出 `cache apply --id <id> --decision write|discard`；在明确确认前不出现 `cache apply`。
- 行动计划输出严格 JSON：`commands` 为有序字符串数组，`confirmation` 含 `required` 与 `requested` 布尔值，`rationale` 为简短依据。凡是仍需等待具体操作授权的合并、删除、分类标准/override、旧分组、评分或修复计划，`required` 与 `requested` 必须都为 `true`，即使当前 `commands` 仅包含只读诊断；配置字段非法、`config validate` 失败或库损坏的诊断也属于这一类，因为后续任何 reset/repair 都必须先由用户选择。请求确认不等于已确认。已有明确授权且操作范围未变时，不再作为待确认计划，两者均为 `false`，`commands` 可包含已授权操作；无写入需求的只读计划两者也均为 `false`。
