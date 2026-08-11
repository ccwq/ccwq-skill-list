# Migration rules

`self-memory/memory.md` 是只读 legacy 来源。使用 `legacy scan` 获得覆盖完整原始 bytes 的 SHA-256 snapshot 与 `U001...` 临时编号；迁移计划必须回传 snapshot、每项的唯一 temporary_id 与对应 raw range 的 source_hash，另提供 type、content 和可选 group。`legacy migrate` 允许部分成功：只移除成功项的原始范围；失败项保持原始 bytes（含 CRLF、空格）与顺序。

当前结构化首版是 v1，`migrate-schema` 会明确报告“无可迁移前版/当前已是 v1”，不会伪造迁移。未知未来版本拒绝读写，避免静默丢失数据。
