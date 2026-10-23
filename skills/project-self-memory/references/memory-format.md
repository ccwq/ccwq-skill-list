# Memory format

活动文件是 `<project-root>/.project-self-memory/memory.md`。首行必须是：

```md
<!-- <psm-store version="1" next_id="0001" group_dimension="" /> -->
```

记录为单行 XML-like 元数据后接正文。只允许 `psm-store`、`psm-group`、`psm` 自闭合元素、双引号和必要实体转义；拒绝未知/重复属性、嵌套、DOCTYPE、CDATA、命名空间。

```md
<!-- <psm id="0001" type="pitfall" status="active" positive="0" negative="0" created_at="2026-08-05T09:16:00Z" last_scored_at="" /> -->
正文
```

`type`: experience, pitfall, decision, constraint, fact。`status`: active, review, disabled。`positive`/`negative` 是非负整数；`created_at` 必须为 UTC 秒级时间，`last_scored_at` 为同格式或空串。ID 永不复用，`next_id` 必须严格大于所有已分配 ID。分组标题后紧跟合法 `psm-group` 才是边界；其他 Markdown（包括 `##`）属于正文。

## 正文：历史可读，新写单行

两个层次必须区分：

- **历史正文可读**：存量记录允许多行 Markdown；解析、读取、inspect 与检索照常工作。引入单行契约不需要迁移，历史记录不因格式重写。
- **新正文必须单行**：任何实际新增或变化正文（CLI `add`、显式 `update`、`merge`、`legacy migrate`、MemorySession 自动保存、查看器正文编辑）在写入前经过确定性校验：去除首尾空白后必须单行（不得含内部换行、CRLF 或 U+2028/U+2029），不得以标题、列表或代码围栏开头，不得包含 psm 结构标记。元数据单独变更（status、score、tags、groups）与 no-op 不触发校验，不要求重写旧正文。

单行契约与宿主侧 STE 改写原则的完整说明见 [expression-contract.md](expression-contract.md)；校验失败时 CLI 输出 `PSM_CONTRACT` 错误并在任何持久化副作用（含账本追加、备份）之前拒绝。宿主在调用写入入口前按契约改写候选正文；改写不增加写操作授权。

## 可选主题标签：`tags.json`

新分类推荐使用派生多标签。项目分类标准位于 `.project-self-memory/tags.json`，不增加 `psm` 属性，也不把标签写回 `memory.md`。标签由当前正文与分类标准即时计算，不参与 `record_version`，不改变已有评分投影。迁移记忆目录时应一并保留此文件；旧 CLI/查看器忽略它。

```json
{
  "version": 1,
  "tags": [
    { "name": "component:api", "any": ["api-gateway", "request-router"], "all": ["timeout"] },
    { "name": "host_scope:tenc" }
  ],
  "overrides": {
    "0001": { "add": ["component:api"], "remove": ["host_scope:tenc"] }
  }
}
```

- 顶层仅接受 `version`、`tags`、`overrides`；`version` 必须为 `1`，`tags` 是最多 256 条不重名规则的数组；`overrides` 可省略，默认 `{}`。
- 每条规则仅接受 `name`、可选 `any`、可选 `all`。关键词数组省略时为 `[]`；每组最多 64 项，每项为去除首尾空白后非空的字面量，输入长度最多 128 字符。
- 标签为小写 `name` 或 `key:value`，最多 128 字符，语法为 `^[a-z0-9][a-z0-9_-]*(:[a-z0-9][a-z0-9_.-]*)?$`。
- `overrides` 按现存记录 ID 修正，子对象仅接受 `add`、`remove`，省略时为 `[]`；每条 `add` 最多 8 项、`remove` 最多 256 项。显式应用计划时拒绝未知记录 ID。

### 派生与排序

1. 内置规则识别正文每行行首（允许前导空白）的 `[key=value]`，派生 `key:value`；`[key=v1,v2]` 派生两个标签，例如 `[host_scope=qbox,tgate]` → `host_scope:qbox`、`host_scope:tgate`。前缀使用小写合法标识，不改写原正文。
2. 分类标准按正文匹配关键词：`any` 非空时至少命中一项，`all` 必须全部命中；二者同时存在时需同时满足。两者都为空只声明标签，不凭空匹配所有记录。
3. 合入记录的 `overrides.add`，再剔除 `overrides.remove`；同一标签同时出现时移除优先。
4. 去重后每条最多保留 8 个标签；显式添加优先占用名额，再取内置前缀与规则命中。展示顺序为 taxonomy 声明顺序，未声明标签按英文词典序排列；首个标签用于查看器分组。

关键词采用大小写不敏感的**字面量子串**匹配，不支持用户正则，也不保证词边界；应选择精确的项目组件名、主机名等词，避免短词误命中。项目维护自己的 taxonomy，没有固定业务分类。

### 降级与写入边界

- 文件缺失或仅有空白：启用空 taxonomy，仍使用内置前缀规则，不发 warning，不自动创建文件。
- JSON/结构非法、非法标签、超出大小限制（1 MiB）或读取失败：全部标签关闭（包括内置规则），返回 `kind: "tags"`、`impact: "warning"` 的诊断；记忆读写、评分与自动任务继续按既有规则工作。通过 `diagnose`、`tags show`/`stats` 或查看器快照查看原因。
- 读取、建议与统计不写盘。人工先审阅提案，再通过已授权的 `tags apply` 或 `tags set` 修改分类标准；不直接编辑活动 `tags.json`。计划文件可以人工编辑，格式为上面的完整 taxonomy 对象。
- 写入共用 `memory.lock`，已有文件在替换前备份到 `backups/tags-<UUID>.json` 并校验，再原子替换；字节相同不备份、不替换，拒绝替换符号链接。首次创建没有旧文件可备份。`memory.md` 与 `evidence.jsonl` 不受该写入影响。
- `group` 的解析、序列化与哈希语义保持不变，不自动迁移或删除旧分组；详见 [grouping-rules.md](grouping-rules.md)。命令参数仅在[根 README](../../../README.md#project-self-memory)维护，输出契约见 [cli-contract.md](cli-contract.md)。
