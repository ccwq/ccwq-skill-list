# 引入批次 ad63d4c

- **真实引入提交**：[ad63d4c](https://github.com/ccwq/ccwq-skill-list/commit/ad63d4c)
- **作者日期**：2026-08-05
- **批次 Skill**：`dockerhub-mirror`
- **根日志索引**：[CHANGELOG.md](../../CHANGELOG.md#skill-快速查找)

批次成员固定；后续变化持续记录在本文件对应 Skill 下，不因调整提交新建该 Skill 的批次。

## dockerhub-mirror

当前说明：[README](../../skills/dockerhub-mirror/README.md)。

### 首次引入

- **2026-08-05**：加入 Docker Hub 拉取慢或失败的分诊，支持候选探测、比较、发现和缓存管理；写入分支先讨论与授权，不自动改 daemon、重启 Docker 或代用户执行 pull/run，也不把私有凭据发给公共镜像。[ad63d4c](https://github.com/ccwq/ccwq-skill-list/commit/ad63d4c)

### 重要调整

- **2026-08-17**：共识口令仍为 `ok`，具体执行授权从“授权执行”改为精确 `okok`；范围、成本、风险或路径改变时重新讨论。[6f4eefa](https://github.com/ccwq/ccwq-skill-list/commit/6f4eefa)
