# 引入批次 5c8f9ca

- **真实引入提交**：[5c8f9ca](https://github.com/ccwq/ccwq-skill-list/commit/5c8f9ca)
- **作者日期**：2026-07-20
- **批次 Skill**：`gemin-mirror`
- **根日志索引**：[CHANGELOG.md](../../CHANGELOG.md#skill-快速查找)

批次成员固定；后续变化持续记录在本文件对应 Skill 下，不因调整提交新建该 Skill 的批次。

## gemin-mirror

当前说明：[README](../../skills/gemin-mirror/README.md)。

### 首次引入

- **2026-07-20**：纳入 Gemini 镜像站浏览器操作 Skill，已有账号探针、账号切换和会话删除流程；要求用户手动调用、复用已打开的标签页，并在授权范围内执行。[5c8f9ca](https://github.com/ccwq/ccwq-skill-list/commit/5c8f9ca)

### 重要调整

- **2026-07-20**：收敛为 Gemini/兼容镜像站的多账号会话探针与安全删除；删除前核对允许 origin、登录状态、唯一活动账号和原生计数。当前账号优先 API runner，DOM 仅作用户明确选择的回退；多账号逐一切换核验，刷新后计数仍为零才判成功，审计只保留脱敏证据。[b382a0f](https://github.com/ccwq/ccwq-skill-list/commit/b382a0f)
