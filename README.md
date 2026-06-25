# Claude Code Skill 仓库

本仓库用于存放和管理 Claude Code 的自定义 Skill。

https://github.com/ccwq/ccwq-skill-list

本 README 只做两件事：**安装索引** 与 **各 skill 的参数速查**。每个 skill 的完整说明在其自身的文档里，文末链接直达。

## 快速开始

最简：交互式选择并安装全部可用 skill。

```bash
npx -y skills add ccwq/ccwq-skill-list
```

逐步加参数（按需组合）：

```bash
# 1) 完整写法（等价于上面的简写）
npx -y skills add https://github.com/ccwq/ccwq-skill-list

# 2) 加 --skill：只装指定的 skill（可多个）
npx -y skills add https://github.com/ccwq/ccwq-skill-list --skill git-up nano-prompt

# 3) 加 --agent claude-code：安装到 Claude Code
npx -y skills add https://github.com/ccwq/ccwq-skill-list --agent claude-code

# 4) 组合：指定 skill + 安装到 Claude Code
npx -y skills add https://github.com/ccwq/ccwq-skill-list --agent claude-code --skill git-up nano-prompt
```

> 仓库根目录已存在 `.claude-plugin/marketplace.json`，仓库正在向 Plugin Marketplace 形态演进；当前实际内容仍以 `skills/` 为主，故安装方式只保留基于 `skills` CLI 的形式。

## 可用 Skill

| Skill | 说明 | 详情 |
|-------|------|------|
| `software-license-checker` | 评估软件企业内部使用的许可证合规风险，输出法务预警报告 | [SKILL.md](skills/software-license-checker/SKILL.md) |
| `git-history-cleaner` | 清理 Git 仓库历史中的特定文件或目录 | [SKILL.md](skills/git-history-cleaner/SKILL.md) |
| `git-up` | Git 提交综合工具，支持规划、讨论、修改和执行提交 | [SKILL.md](skills/git-up/SKILL.md) |
| `nano-prompt` | AI 图像提示词生成，基于分层结构构建专业级提示词 | [SKILL.md](skills/nano-prompt/SKILL.md) |
| `ffmpeg-video-processing` | 使用 ffmpeg / ffprobe 处理音视频，包括压缩、转码、裁剪与媒体检查 | [SKILL.md](skills/ffmpeg-video-processing/SKILL.md) |
| `rd-mode` | 远程开发模式规则，约束 host/server 协作并统一 CDP 浏览器操作（abc 命令） | [README.md](skills/rd-mode/README.md) |
| `lite-team` | 轻量多 Agent 协作，用 docs/bbs/lite-team-bbs.md 协作板在不同 Agent/session 间手动交接 | [README.md](skills/lite-team/README.md) |

> 触发形式：`/skill-name` 偏 slash command 风格，`$skill-name` 偏按 skill 名触发；实际以你的 Claude Code / skills 运行环境为准。

## 参数速查

只列调用方式与参数。完整流程、注意事项见每个 skill 的「详情」链接。

### software-license-checker

评估软件在企业内部使用场景下的许可证、授权与潜在付费要求。

```text
$software-license-checker 检查 FFmpeg 是否可以在企业内部使用
$software-license-checker TensorFlow 企业内部研发使用是否需要付费
```

无显式参数，直接描述待评估的软件与使用场景即可。详情见 [SKILL.md](skills/software-license-checker/SKILL.md)。

---

### git-history-cleaner

清理 Git 仓库历史中的特定文件或目录以减小仓库体积。

```text
$git-history-cleaner --repo /path/to/repo --path bin/ --dry-run
$git-history-cleaner --repo /path/to/repo --path "*.log" --auto
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--repo` | 仓库路径 | 当前目录 |
| `--path` | 要删除的路径模式 | 必填 |
| `--dry-run` | 预览模式，只分析不执行 | false |
| `--auto` | 自动模式，无需确认 | false |

改写历史会改变提交 ID，执行前会创建 `.git` 备份。详情见 [SKILL.md](skills/git-history-cleaner/SKILL.md)。

---

### git-up

Git 提交综合工具，支持规划、讨论、修改和执行提交。

```text
/git-up --plan, -p      # 分析 diff，生成并保存 YAML 提交计划
/git-up --discuss        # 询问用户对计划的意见
/git-up --modify <内容>  # 根据反馈调整并同步已保存计划
/git-up --commit, -c    # 执行已保存且未过期的计划
/git-up                  # 直接生成 commit message
```

模式：plan / discuss / modify / commit / default。`--plan` 可简写为 `-p`，`--commit` 可简写为 `-c`；`--plan` 会在 Git 内部路径保存计划工件，`--commit` 只执行已保存且未过期的计划。详情见 [SKILL.md](skills/git-up/SKILL.md)。

---

### nano-prompt

AI 图像提示词生成，基于 Nano Banana Pro 的核心提示技巧，输出 YAML 格式的分层提示词结构。

```text
/nano-prompt 一个赛博朋克女孩在霓虹雨夜中行走
/nano-prompt 宫崎骏风格的中国古建筑风景
```

无显式参数，直接描述画面即可。输出含创意/光线/氛围/环境/相机/颜色/纹理/风格/细节/负面等分层结构。详情见 [SKILL.md](skills/nano-prompt/SKILL.md)。

---

### ffmpeg-video-processing

通过 ffmpeg / ffprobe 处理音视频，包括压缩、转码、裁剪、缩放、变帧率、抽取音频、拼接、字幕烧录、水印与媒体检查。

```text
/ffmpeg-video-processing 把 input.mov 压缩成更小的 mp4，尽量保留清晰度
/ffmpeg-video-processing 把 video.mp4 裁掉前 5 秒并导出为 webm
/ffmpeg-video-processing 检查这个文件的编码、分辨率和时长
```

无显式参数，用自然语言描述处理目标。本机缺少 `ffmpeg`/`ffprobe` 时需先提供路径或确认下载。详情见 [SKILL.md](skills/ffmpeg-video-processing/SKILL.md)。

---

### rd-mode

远程开发模式规则，约束 host/server 协作并统一通过 `abc` 命令操作 host 浏览器（CDP）。

```text
rd-mode --init   # 首次使用，问答补全 RHost / CDP_PORT，写入 ~/.config/rd-mode/.env
```

| 参数 | 说明 |
|------|------|
| `--init` | 生成本地配置（`RHost`、`CDP_PORT`） |

详情、host/server 架构、`abc` 用法与故障排查见 [README.md](skills/rd-mode/README.md)。

---

### lite-team

手动角色协作，按需用 BBS 协作板交接；不自动编排、不自动读取。

```text
/role 开发
给测试 Agent 留一条交接：登录异常分支已完成，需验证错误凭证、重复提交和超时。
/role 测试
读取协作板
/done
```

| 快捷命令 | 说明 |
|------|------|
| `/role <角色名>` | 切换当前 session 角色 |
| `/bbs init` | 初始化协作板 |
| `/bbs read` | 读取协作板 |
| `/bbs write` | 写入一条交接 |
| `/done` | 生成拟归档摘要，等用户确认 |

脚本命令（Python 3，≥3.8，统一用 `python3`）：

| 命令 | 说明 |
|------|------|
| `init` | 初始化协作板 |
| `add` | 写入一条交接（自动生成 id，守 7 条上限与 500 字软约束） |
| `status` | 查看消息数量 |
| `clear --yes` | 清空当前消息，保留历史 |
| `archive --summary` | 确认归档后写入历史 |

BBS 会提交 Git，勿写密钥/Token；message 最多 7 条，history 最多 9 条。详情见 [README.md](skills/lite-team/README.md)。

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
