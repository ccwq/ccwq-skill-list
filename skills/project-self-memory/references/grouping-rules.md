# Grouping rules（旧分组兼容）

新分类推荐可选的派生多标签，项目 taxonomy 与规则见 [memory-format.md](memory-format.md)。标签支持一条记忆多个主题，不要求全库分配，不改变记录版本。现有 `group` 的解析、序列化和哈希语义保持不变；不自动删除、迁移或重构旧分组。

`group_dimension` 是一次旧分组采用的唯一分类维度。计划须完整给出非空 `group_dimension`、每个稳定分组 ID、标题、scope，以及每条现存记录到 group ID 或 `null` 的映射。记录至多属于一个分组；跨组通用记录映射为 `null`。`groups apply` 不允许删除既有稳定 ID；标题与 scope 可通过 `groups rename` 更新。

维护旧分组仍需具体操作授权。更改记录 `group` 会改变 `record_version`，旧版本评分证据不会自动转移；增加或修正派生标签则不改变该版本。自动检索的多样性仍以 `group` 分桶，不以首标签替代；查看器的首标签视图只是展示分组。命令参数统一见[根 README](../../../README.md#project-self-memory)。
