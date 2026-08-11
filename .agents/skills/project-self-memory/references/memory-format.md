# Memory format

活动文件是 `<project-root>/.project-self-memory/memory.md`。首行必须是：

```md
<!-- <psm-store version="1" next_id="0001" group_dimension="" /> -->
```

记录为单行 XML-like 元数据后接非空 Markdown 正文。只允许 `psm-store`、`psm-group`、`psm` 自闭合元素、双引号和必要实体转义；拒绝未知/重复属性、嵌套、DOCTYPE、CDATA、命名空间。

```md
<!-- <psm id="0001" type="pitfall" status="active" positive="0" negative="0" created_at="2026-08-05T09:16:00Z" last_scored_at="" /> -->
正文
```

`type`: experience, pitfall, decision, constraint, fact。`status`: active, review, disabled。`positive`/`negative` 是非负整数；`created_at` 必须为 UTC 秒级时间，`last_scored_at` 为同格式或空串。ID 永不复用，`next_id` 必须严格大于所有已分配 ID。分组标题后紧跟合法 `psm-group` 才是边界；其他 Markdown（包括 `##`）属于正文。
