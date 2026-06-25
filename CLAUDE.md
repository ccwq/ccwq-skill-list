# CLAUDE.md

## 项目概述

本项目是 Claude Code 的 Skill 仓库，用于存放和管理各类自定义 Skill。

## 目录结构

- `skills/` - Skill 存放目录
- `CLAUDE.md` - 项目配置文档
- `README.md` - 项目说明文档

## Skill 开发规范

### 文件结构
每个 Skill 必须包含 `SKILL.md`（大写）定义文件，可按需附带 `CHANGELOG.md` 及 `agents/`、`references/`、`scripts/` 等辅助目录。`SKILL.md` 是面向 Claude 自动加载的文档；如需面向人类的安装/配置说明，可额外提供 `README.md`（参考 `skills/rd-mode/`）。

### 命名规范
- 使用小写字母和连字符
- 主名称与子名称使用冒号分隔（如：`领域:名称`）

## 文档规范（README）

根 README 只承担两件事：**安装索引** 与 **参数速查**，不写长篇流程说明。具体分工：

- **根 README**：安装方式 + 可用 skill 索引表 + 各 skill 的「参数速查」（调用示例、参数表、一句注意事项）。
- **skill 自身文档**：完整流程、注意事项、架构等细节，放在该 skill 的 `SKILL.md`（或 `README.md`）中。
- **参数说明只在根 README 维护一处**，skill 文档不重复列参数，避免双份维护。
- 根 README 每个 skill 都要有一个「详情」链接，指向其 `SKILL.md`（已提供 `README.md` 的 skill 指向 `README.md`）。

### 渐进式安装写法

安装说明一律「最简 → 逐步加参数」：先给一行最简命令，再逐步叠加 `--skill`、`--agent claude-code` 等参数并组合，而非平铺多个并列小节。

### 新增 / 重构 skill 的清单

新增或重命名 skill 时，必须同步更新根 README：

1. 「可用 Skill」索引表新增/修改一行（名称、一句说明、详情链接）。
2. 「参数速查」新增/修改对应小节（调用示例 + 参数表 + 注意事项 + 详情链接）。
3. 确认详情链接路径真实存在，无断链。
