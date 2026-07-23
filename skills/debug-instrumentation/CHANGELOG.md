# Changelog

All notable changes to this skill will be documented in this file.

## [1.0.0] - 2026-07-23

### Added / 新增

- 新增跨语言的调试埋点闭环：埋点、采集、假设归因和询问式清理。
- 统一 `[DBG_<label>_<suffix>]` token 契约及 JS/Python 示例。
- 新建批次前检索历史 `[DBG_]`，支持用户确认后沿用、清理后新增或仅新增；完整 token 支持跨会话清理。
- 新增 3 个覆盖异步埋点、Python 日志归因和清理确认门禁的 eval 场景。
