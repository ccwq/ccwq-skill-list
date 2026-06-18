# Claude Code Skill 仓库

本仓库用于存放和管理 Claude Code 的自定义 Skill。

https://github.com/ccwq/ccwq-skill-list

## 当前状态

当前仓库的实际内容仍以 `skills/` 目录为主，适合按单个 skill 进行安装与维护。

根目录已经存在 `.claude-plugin/marketplace.json`，说明仓库正在向 Claude Code Plugin Marketplace 形态演进；但由于当前工作树尚未落地 `plugins/` 目录，README 目前优先描述**当前真实可用**的安装方式，并把 marketplace 仅作为迁移方向说明。

## 可用 Skill

| Skill | 说明 |
|-------|------|
| `software-license-checker` | 评估软件企业内部使用的许可证合规风险，输出法务预警报告 |
| `git-history-cleaner` | 清理 Git 仓库历史中的特定文件或目录 |
| `git-up` | Git 提交综合工具，支持规划、讨论、修改和执行提交 |
| `nano-prompt` | AI 图像提示词生成，基于分层结构构建专业级提示词 |
| `ffmpeg-video-processing` | 使用 ffmpeg / ffprobe 处理音视频文件，包括压缩、转码、裁剪与媒体检查 |

## 安装方式

### Claude Code 安装说明

如果你在 Claude Code 中使用本仓库，当前更适合把它视为一个**正在迁移到 marketplace 的 skill 集合仓库**。

当前状态下建议：
- 先按需查看 `skills/` 目录，确认要使用的 skill
- 以当前真实存在的 `skills/<name>/` 目录为安装来源
- 如需验证 marketplace 方向，可在本地仓库结构补齐后，再使用 Claude Code 的 marketplace / plugin 安装链路

当前工作树还没有落地 `plugins/` 目录，因此 README 暂时**不把 Claude Code marketplace 命令写成正式默认安装方式**，避免文档与仓库事实不一致。

### Codex / 兼容环境安装说明

如果你在 Codex 或其他兼容的 agent / skill 运行环境中使用本仓库，建议同样按单个 skill 目录进行安装或引入。

由于不同运行环境对 skill 的加载入口、命令格式和目录 URL 解析方式可能不同，README 这里不写死某个特定平台的唯一命令，而是统一按 `skills/<name>/` 目录组织来说明。

### npx skills add 安装说明

当前仓库最稳定、最符合实际结构的方式，是按 `skills/<name>/` 目录安装单个 skill。

适用场景：
- 只需要安装某一个 skill
- 希望 README 与当前工作树保持一致
- 不想依赖尚未完全落地的 marketplace 结构

示例模式：

```bash
npx -y skills add <仓库中目标 skill 的目录地址>
```

示例 skill：

```text
skills/git-up
skills/nano-prompt
skills/software-license-checker
skills/ffmpeg-video-processing
```

建议先浏览仓库中的 `skills/` 目录，再按目标 skill 目录进行安装。

### 兼容路径：旧式直装方式

如果你当前仍使用旧的 skill 直装工作流，可以继续沿用“从仓库的单个 skill 目录安装”的思路，但它更适合作为兼容路径，而不是默认推荐路径。

注意：
- 当前示例仍基于 `skills/<name>/` 目录组织
- README 不再写死某个固定分支名
- 后续仓库若完成 marketplace 迁移，这类直装路径可能会继续调整

### Marketplace 迁移说明

仓库根目录已存在 `.claude-plugin/marketplace.json`，代表未来方向是 Plugin Marketplace。

但由于当前工作树还没有与之对应的 `plugins/` 目录，README 暂时**不把 marketplace 命令写成正式可用的默认安装方式**，避免文档与仓库事实不一致。

如果未来完成目录迁移并验证安装链路，README 再切换为 marketplace 主推荐路径会更合适。

## 使用说明

下面的示例只演示各 skill 的典型调用方式。安装说明统一放在上面的“安装方式”章节中，避免重复维护。

### 触发形式说明

- 以 `/skill-name` 形式展示的示例，表示偏 slash command 风格的调用示意。
- 以 `$skill-name` 形式展示的示例，表示按 skill 名触发的调用示意。
- 实际触发方式应以你的 Claude Code / skills 运行环境为准。

## Skill 详细介绍

### software-license-checker

评估软件在企业内部使用场景下的许可证、授权与潜在付费要求。

**使用：**
```text
$software-license-checker 检查 FFmpeg 是否可以在企业内部使用
$software-license-checker TensorFlow 企业内部研发使用是否需要付费
```

**适用场景：** 软件授权合规、license 检查、开源协议风险、是否需要商业授权

---

### git-history-cleaner

清理 Git 仓库历史中的特定文件或目录以减小仓库体积。

**使用：**
```text
$git-history-cleaner --repo /path/to/repo --path bin/ --dry-run
$git-history-cleaner --repo /path/to/repo --path "*.log" --auto
```

**参数：**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--repo` | 仓库路径 | 当前目录 |
| `--path` | 要删除的路径模式 | 必填 |
| `--dry-run` | 预览模式，只分析不执行 | false |
| `--auto` | 自动模式，无需确认 | false |

**注意：** 改写历史会改变提交 ID，执行前会创建 `.git` 备份。

---

### git-up

Git 提交综合工具，支持规划、讨论、修改和执行提交。

**使用：**
```text
/git-up --plan        # 分析 diff，生成 YAML 提交计划
/git-up --discuss     # 询问用户对计划的意见
/git-up --modify <内容>  # 根据反馈调整计划
/git-up --commit      # 执行实际提交
/git-up               # 直接生成 commit message
```

**模式：** plan / discuss / modify / commit / default

---

### nano-prompt

AI 图像提示词生成技能，基于 Nano Banana Pro 的 20 条核心提示技巧，输出 YAML 格式的分层提示词结构。

**使用：**
```text
/nano-prompt 一个赛博朋克女孩在霓虹雨夜中行走
/nano-prompt 宫崎骏风格的中国古建筑风景
```

**核心结构：**

```yaml
创意: 核心主题/主体描述
光线: 光线类型、色温、方向
氛围: 情感氛围关键词
环境: 背景、场景设置
相机: 焦距、光圈、拍摄角度
颜色: 主色调及情感关联
纹理: 材质描述
风格: 风格锚点（1-2个）
细节: 微细节关键词（1-3词触发）
负面: 需要避免的元素
```

**技巧要点：**
- 风格锚点选 1-2 个（吉卜力、写实摄影、赛博朋克、皮克斯等）
- 使用电影级相机参数（35mm、50mm、低角度、仰拍等）
- 微细节触发词：尘埃颗粒、胶片颗粒、冰冷反射等

---

### ffmpeg-video-processing

通过 ffmpeg / ffprobe 处理音视频文件，包括压缩、转码、裁剪、缩放、变帧率、抽取音频、拼接、字幕烧录、水印与媒体检查。

**使用：**
```text
/ffmpeg-video-processing 把 input.mov 压缩成更小的 mp4，尽量保留清晰度
/ffmpeg-video-processing 把 video.mp4 裁掉前 5 秒并导出为 webm
/ffmpeg-video-processing 检查这个文件的编码、分辨率和时长
```

**注意：**
- 处理前优先用 `ffprobe` 检查媒体信息
- 如果本机没有 `ffmpeg` 或 `ffprobe`，应先提供二进制路径或确认下载官方构建
- 若用户要求严格目标体积，通常优先采用两遍编码

---

## 目录结构

```text
ccwq-skill-list/
├── .claude-plugin/
│   └── marketplace.json     # Marketplace 元数据（迁移方向）
├── skills/                  # 当前实际生效的 Skill 目录
├── scripts/                 # 辅助脚本
├── test-space/              # 测试与验证空间
├── CLAUDE.md                # 项目配置文档
└── README.md                # 项目说明文档
```

## License

MIT
