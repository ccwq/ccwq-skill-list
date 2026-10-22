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
| 查看器 | `viewer install`, `viewer update`, `viewer status` |

所有命令接受 `--project-root <path>`。`groups apply` 计划须含非空 `group_dimension`、完整 `groups`、完整 `assignments`（每个现存记录为 group ID 或 null），且不可删除已有稳定 group ID。`legacy scan` 返回 SHA-256 snapshot；迁移计划必须回传该 snapshot，且每项含唯一 temporary_id、source_hash、type、content。计划不合法时不修改库。`migrate-schema` 在 v1 输出“无可迁移前版”，未知/未来版本拒绝。

`viewer` 命令族管理紧凑查看器部署：`init` 自动安装；`viewer install` 显式安装且幂等；`viewer update` 只在整文件 SHA-256 命中官方 `viewer-dist/manifest.json` 时替换，本地修改或符号链接拒绝；`viewer status` 输出 `{exists, official, up_to_date}` JSON，不信任文件自报版本。HTTP 契约与安全模型见 [viewer.md](viewer.md)。
