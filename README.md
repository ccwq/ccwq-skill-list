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

### 通用安装：手动选择 skill

使用 `skills` CLI 从仓库中读取可用 skill，并在交互界面中手动选择需要安装的内容。

简写
```bash
npx skills ccwq/ccwq-skill-list
```
完整
```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list
```


### 通用安装：指定 skill

如果只想安装部分 skill，可以通过 `--skill` 指定名称。

```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list --skill git-up nano-prompt
```

### Claude Code 安装

如果要把 skill 安装到 Claude Code，使用 `skills` CLI 的 `--agent claude-code` 参数。

```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list --agent claude-code
```

指定部分 skill 安装到 Claude Code：

```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list --agent claude-code --skill git-up nano-prompt
```

说明：仓库根目录虽然已经存在 `.claude-plugin/marketplace.json`，但当前实际内容仍以 `skills/` 目录为主；因此 README 目前只保留基于 `skills` CLI 的安装方式。

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
