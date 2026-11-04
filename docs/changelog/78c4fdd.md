# 引入批次 78c4fdd

- **真实引入提交**：[78c4fdd](https://github.com/ccwq/ccwq-skill-list/commit/78c4fdd)
- **作者日期**：2026-07-20
- **批次 Skill**：`npm-license-declaration`
- **根日志索引**：[CHANGELOG.md](../../CHANGELOG.md#skill-快速查找)

批次成员固定；后续变化持续记录在本文件对应 Skill 下，不因调整提交新建该 Skill 的批次。

## npm-license-declaration

当前说明：[SKILL](../../skills/npm-license-declaration/SKILL.md)。

### 首次引入

- **2026-07-20**：加入前端 npm 第三方许可证声明生成器，按 `dependencies` 与 `devDependencies` 的直接依赖重建 `docs/npm-license-declaration.md`，不遍历传递依赖；元数据采用 npm latest，缺失与查询失败如实标记，结果是风险提示而非法务意见。[78c4fdd](https://github.com/ccwq/ccwq-skill-list/commit/78c4fdd)
