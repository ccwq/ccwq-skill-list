# Triage Labels

下表将 skill 使用的五个标准角色映射为本仓库的状态名称。

| 标准角色 | 本仓库名称 | 含义 |
| --- | --- | --- |
| needs-triage | needs-triage | 等待维护者评估 |
| needs-info | needs-info | 等待报告者补充信息 |
| ready-for-agent | ready-for-agent | 规格充分，可交给 agent 执行 |
| ready-for-human | ready-for-human | 需要人工实现 |
| wontfix | wontfix | 不予处理 |

当 skill 要求应用某个 triage 角色时，使用表中对应名称。

普通工单在顶部的 `Status:` 行记录；
wayfinding 工单的 `Status:` 用于执行状态，因此在 `Triage:` 行记录分类。
详见 `issue-tracker.md`。

以后若需使用已有状态名称，修改表中的“本仓库名称”列即可。
