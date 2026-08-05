# Grouping rules

`group_dimension` 是一次分组采用的唯一分类维度。计划须完整给出非空 `group_dimension`、每个稳定分组 ID、标题、scope，以及每条现存记录到 group ID 或 `null` 的映射。记录至多属于一个分组；跨组通用记录映射为 `null`。`groups apply` 不允许删除既有稳定 ID；标题与 scope 可通过 `group rename` 更新。
