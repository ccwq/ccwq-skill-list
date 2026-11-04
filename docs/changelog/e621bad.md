# 引入批次 e621bad

- **真实引入提交**：[e621bad](https://github.com/ccwq/ccwq-skill-list/commit/e621bad)
- **作者日期**：2026-07-23
- **批次 Skill**：`debug-instrumentation`
- **根日志索引**：[CHANGELOG.md](../../CHANGELOG.md#skill-快速查找)

批次成员固定；后续变化持续记录在本文件对应 Skill 下，不因调整提交新建该 Skill 的批次。

## debug-instrumentation

当前说明：[SKILL](../../skills/debug-instrumentation/SKILL.md)。

### 首次引入

- **2026-07-23**：加入假设驱动的调试埋点闭环，以统一可搜索 token 标识每批日志，串起埋点、采集、归因和清理；遇到历史批次先让用户决定沿用或处理，清理需确认，不把预期日志当真实运行证据。[e621bad](https://github.com/ccwq/ccwq-skill-list/commit/e621bad)
