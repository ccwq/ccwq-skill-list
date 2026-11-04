# 仓库共用日志

返回根日志索引：[CHANGELOG.md](../../CHANGELOG.md#仓库共用变化)。

## 仓库共用变化

### 安装、发现与文档入口

- **2026-04-08**：初始化以 `skills/` 存放 Skill 的仓库；同日把 `git-up/skill.md` 规范为大写 `SKILL.md`。这是定义文件命名规范化，不是 Skill 名称更改。[690e2b4](https://github.com/ccwq/ccwq-skill-list/commit/690e2b4) · [81f0b6f](https://github.com/ccwq/ccwq-skill-list/commit/81f0b6f)
- **2026-06-17**：为当时已有 Skill 补充各自的版本字段、Skill 级日志与维护工具。各 Skill 的版本独立，不形成整个仓库的统一发布边界。[aa8c031](https://github.com/ccwq/ccwq-skill-list/commit/aa8c031)
- **2026-06-18**：加入 Plugin Marketplace 元数据；这只证明仓库有插件清单，不证明插件安装路径已被验证。当前安装口径仍以 README 的 `skills` CLI 为准。[f469184](https://github.com/ccwq/ccwq-skill-list/commit/f469184)
- **2026-06-25**：根 README 收敛为安装索引和参数速查，采用“最简命令 → 逐步叠加参数”的安装写法；完整流程移到各 Skill 文档，并要求详情链接与 marketplace 同步维护。[023c258](https://github.com/ccwq/ccwq-skill-list/commit/023c258)
- **2026-08-06**：增加主 Skill 分组清单和生成的插件入口，区分交互安装选择器中的主分组与其他已发现 Skill。[851b9dc](https://github.com/ccwq/ccwq-skill-list/commit/851b9dc)
- **2026-08-11**：主分组配置支持多行；为 `codex-windows-hooks-fix`、`debug-instrumentation`、`git-history-cleaner`、`lite-team`、`nano-prompt`、`ntl-script-descriptions`、`rd-mode`、`software-license-checker`、`subagent-router` 补充 `disable-model-invocation` 手动调用标记，减少未经显式调用的自动触发。[3677724](https://github.com/ccwq/ccwq-skill-list/commit/3677724) · [5ae8b3f](https://github.com/ccwq/ccwq-skill-list/commit/5ae8b3f) · [0cc56ec](https://github.com/ccwq/ccwq-skill-list/commit/0cc56ec) · [ccd2a55](https://github.com/ccwq/ccwq-skill-list/commit/ccd2a55)
- **2026-10-15**：重整 README 的安装、索引和折叠参数速查，补齐分层详情入口，并明确外部 `skills` CLI 未固定版本、Plugin Marketplace 安装尚未验证。[252c8eb](https://github.com/ccwq/ccwq-skill-list/commit/252c8eb)

### 旧路径与本地副本

- **2026-04-20**：根目录 `nano-prompt/` 迁为 `skills/nano-prompt/`，定义文件内容完全相同；详见 [nano-prompt](294f65d.md#nano-prompt)。历史盘点将迁移前后视为同一个 Skill。[fb2c46a](https://github.com/ccwq/ccwq-skill-list/commit/fb2c46a)
- **2026-08-11**：历史中加入了 `.agents/skills/project-self-memory/` 和 `.claude/skills/project-self-memory/` 两套项目本地副本；它们不是两个新 Skill，规范分发目录中的同名 Skill 早已存在。[8572510](https://github.com/ccwq/ccwq-skill-list/commit/8572510)
- **2026-10-22**：项目结构整理删除上述两套本地副本，以及根目录 `gemin-mirror/HANDOFF.md` 等工作材料；`skills/project-self-memory/` 与 `skills/gemin-mirror/` 仍保留，不能据此写成 Skill 被移除或互相替代。[1a6c113](https://github.com/ccwq/ccwq-skill-list/commit/1a6c113)

### 打包与跨平台分发

- **2026-08-22**：增加按单个 Skill 或全量生成 `skill-zips/<名称>.zip` 的打包入口，并纳入 ZIP 产物；这是分发形式增加，不将每次重打包计作 Skill 新功能。[c1938a9](https://github.com/ccwq/ccwq-skill-list/commit/c1938a9) · [59b1b64](https://github.com/ccwq/ccwq-skill-list/commit/59b1b64)
- **2026-10-31**：ZIP 写入改用 POSIX 正斜杠条目名，修复 Windows 生成的反斜杠路径在 Linux/macOS 解包异常；随后重建全部 Skill ZIP。该修复影响分发包兼容性，不表示每个 Skill 的业务能力均发生变化。[839cc12](https://github.com/ccwq/ccwq-skill-list/commit/839cc12) · [bd0a0c5](https://github.com/ccwq/ccwq-skill-list/commit/bd0a0c5)
