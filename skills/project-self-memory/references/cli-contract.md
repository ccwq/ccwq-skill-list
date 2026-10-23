# CLI contract

入口：`node scripts/memory.mjs <command> [options]`。成功退出 0；参数、格式或安全拒绝退出 1 并输出 `PSM_ERROR:`。维护读取输出稳定 JSON；普通 `read` 输出人读 Markdown。调用示例与参数的唯一维护处是[根 README](../../../README.md#project-self-memory)，本页定义命令行为与输出。

| 命令族 | 命令 |
|---|---|
| 初始化 | `init`, `validate`, `diagnose` |
| 读取 | `read`, `catalog`, `inspect` |
| 主题标签 | `tags show`, `tags suggest`, `tags apply`, `tags set`, `tags stats` |
| CRUD | `add`, `update`, `status`, `delete` |
| 评分 | `score`, `score-reset`, `score-repair` |
| 生命周期 | `merge`（keep 必须较早）, `groups show|apply|rename|move`, `legacy scan|migrate`, `migrate-schema` |
| 配置 | `config show|validate|set|reset|repair` |
| 查看器 | `viewer install`, `viewer update`, `viewer status` |

## 标签读取与输出

- `tags` 未指定子命令时等同 `show`。`show` 返回 `{taxonomy, diagnostics, enabled}`，taxonomy 是规范化后的完整分类标准。
- `suggest` 返回 `{taxonomy, candidates, truncated_tags, total_records, covered_records, uncovered_ids}`。它扫描所有记录（含非 active），合并现有规则、overrides 与内置前缀生成最多 256 项的 taxonomy；超额数量写入 `truncated_tags`。词频候选是跨至少 2 条记录重复、排除内置停用词的英文标识词，按频次降序、同频词典序排列，最多 32 项，每项为 `{term, record_count}`。候选词不会自动变成规则。
- `suggest` 的覆盖统计针对返回的合并提案；已有规则与 overrides 保留。人工审核并编辑返回的 `taxonomy` 对象作为应用计划，不把整个提案直接应用。该命令不是 AI 分类、不联网、不自动采纳提案。
- `stats` 返回 `{total_records, tagged_records, tags, diagnostics}`，统计所有记录，`tags` 为 `{name, count}[]`，按标签名英文词典序排列。
- `catalog` 标签目录使用相同 `{name, count}[]` 形状，但仅统计有效 active 记录；未选择标签目录时保持旧分组目录输出。
- `read` 的显式多标签条件采用精确匹配、任一命中，与其他读取条件取交集；默认无标签条件时不排除未标记记录。输出仍为既有人读 Markdown，不增加标签元数据行。
- `inspect` 在既有 JSON 记录上附带派生的 `tags` 数组；`read`、`catalog`、`inspect` 和标签只读命令均不修改正文、账本或 taxonomy。

文件缺失或空白时 `enabled: true`，空 taxonomy 仍启用内置 `[key=value]` / `[key=v1,v2]` 规则。文件非法或读取失败时 `enabled: false`，所有记录标签为空，包括内置前缀；`diagnostics` 为 warning，不使普通记忆操作失败。`diagnose` 的 `tags` 字段报告同类诊断，不因标签错误改变 `write_safe`；普通 `read`/`inspect`/`catalog` 不单独输出标签 warning。详细 schema 与规则见 [memory-format.md](memory-format.md)。

## 新正文单行契约与错误行为

提供**新正文**的入口（`add`、显式 `update`、`merge`、`legacy migrate`、MemorySession 自动保存、查看器 PATCH）在写入前经过确定性校验：去除首尾空白后必须单行，不得以标题、列表或代码围栏开头，不得包含 psm 结构标记。文本文件末尾的单个换行会被去除。历史多行正文的读取不受影响；与磁盘一致的 no-op 重提交、纯元数据变更（`status`、`score`、`tags`、`groups`）不触发校验。

- 校验失败时退出 1，错误带 `PSM_CONTRACT` 前缀并列出可定位原因；发生在任何持久化副作用之前——不追加账本事件、不产生备份、不留部分提交。
- `legacy migrate` 不整体失败：多行条目在结果中标 `ok: false` 并给出契约原因，合法条目继续迁移。
- 查看器 PATCH 的同一校验返回 400 `error: "CONTRACT"`，磁盘不变；重提交记录自身正文（即使多行）仍然合法，用于元数据维护。
- CLI 不做语义改写；宿主按 [expression-contract.md](expression-contract.md) 在调用前完成 STE 改写，改写失败时跳过候选而不是原样保存。

## 首次召回计量（宿主结果）

`MemorySession`（不是原始 CLI）在每个计量会话首次成功交付非空上下文时，对最终 `memoryContext` 全文估算一次 token（UTF-16 长度 ÷ 3 向上取整，算法标识 `utf16-length-div-3-ceil`）。估算严格大于 37,000（十进制）时，audit 通道发出 `action: "recall-usage"`、`outcome: "warning"` 事件，payload 附带 `recallUsage` 结构化结果（`checked`、`estimated_tokens`、`exceeded`、`threshold`、`algorithm`、`warning.message`）。提醒正文包含估算值、37,000 阈值、「压缩或复盘记忆」建议与「当前任务继续」含义；不含任何记忆正文。空召回、`auto_load` 关闭、加载失败不消耗检查机会；多任务宿主用共享 `recallState` 界定同一计量会话。原始 `read` 保持只读输出契约，不增加会话提醒。

## 标签显式写入

- `apply` 校验完整 taxonomy 计划，拒绝未知记录 ID 的 override，替换分类标准（不是与旧标准合并）。可用合法计划显式修复损坏的标签文件。
- `set` 要求记录存在，按逗号列表更新已有 override：本次添加会撤销旧移除，本次移除会撤销旧添加；同一标签同时出现在本次添加和移除时，最终派生仍由移除优先。损坏的 taxonomy 必须先经 `apply` 修复。
- 两者返回 `{applied: boolean}`，`false` 表示规范化后的目标字节与已有文件相同。计划或输入非法时退出 1，不落盘。
- 两者需具体操作的人工授权，检查库可写后共用 `memory.lock`；替换前备份已有 taxonomy 并校验，原子替换，拒绝覆盖符号链接。不序列化 `memory.md`，不追加 evidence，不改变 `record_version`；自动保存与评分不调用它们。

## 旧分组、迁移与查看器

新分类推荐标签；旧 `group` 保持解析、序列化与哈希兼容，不自动迁移。`groups apply` 计划须含非空 `group_dimension`、完整 `groups`、完整 `assignments`（每个现存记录为 group ID 或 null），且不可删除已有稳定 group ID。

`legacy scan` 返回 SHA-256 snapshot；迁移计划必须回传该 snapshot，且每项含唯一 temporary_id、source_hash、type、content。计划不合法时不修改库。`migrate-schema` 在 v1 输出“无可迁移前版”，未知/未来版本拒绝。

`viewer` 命令族管理紧凑查看器部署：`init` 自动安装；`viewer install` 显式安装且幂等；`viewer update` 只在整文件 SHA-256 命中官方 `viewer-dist/manifest.json` 时替换，本地修改或符号链接拒绝；`viewer status` 输出 `{exists, official, up_to_date}` JSON，不信任文件自报版本。HTTP 契约与安全模型见 [viewer.md](viewer.md)。
