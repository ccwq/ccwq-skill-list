# CLI contract

入口：`node scripts/memory.mjs <command> [options]`。成功退出 0；参数、格式或安全拒绝退出 1 并输出 `PSM_ERROR:`。维护读取输出稳定 JSON；普通 `read` 输出人读 Markdown。

| 命令族 | 命令 |
|---|---|
| 初始化 | `init`, `validate`, `diagnose` |
| 读取 | `read [--all] [--group ids] [--type type] [--ids ids]`, `catalog`, `inspect [id|--legacy|--groups|--trim-candidates]` |
| CRUD | `add --type type [--group id] --content-file file`, `update id --content-file file [--keep-score]`, `status id status`, `delete --ids ids` |
| 评分 | `score id +1|-1`, `score-reset id`, `score-repair id --positive n --negative n` |
| 生命周期 | `merge --keep id --remove id --content-file file`（keep 必须较早）, `groups show|apply|rename|move`, `legacy scan|migrate`, `migrate-schema` |
| 配置 | `config show|validate|set|reset|repair` |

所有命令接受 `--project-root <path>`。`groups apply` 计划须含非空 `group_dimension`、完整 `groups`、完整 `assignments`（每个现存记录为 group ID 或 null），且不可删除已有稳定 group ID。`legacy scan` 返回 SHA-256 snapshot；迁移计划必须回传该 snapshot，且每项含唯一 temporary_id、source_hash、type、content。计划不合法时不修改库。`migrate-schema` 在 v1 输出“无可迁移前版”，未知/未来版本拒绝。
