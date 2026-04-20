# Claude Code Skill 仓库

本仓库用于存放和管理 Claude Code 的自定义 Skill。

https://github.com/ccwq/ccwq-skill-list

## 可用 Skill

| Skill | 说明 |
|-------|------|
| `software-license-checker` | 评估软件企业内部使用的许可证合规风险，输出法务预警报告 |
| `git-history-cleaner` | 清理 Git 仓库历史中的特定文件或目录 |
| `git-up` | Git 提交综合工具，支持规划、讨论、修改和执行提交 |
| `nano-prompt` | AI 图像提示词生成，基于分层结构构建专业级提示词 |

---

## Skill 详细介绍

### software-license-checker

评估软件在企业内部使用场景下的许可证、授权与潜在付费要求。

**安装：**
```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list/tree/master/skills/software-license-checker
```

**使用：**
```text
$software-license-checker 检查 FFmpeg 是否可以在企业内部使用
$software-license-checker TensorFlow 企业内部研发使用是否需要付费
```

**适用场景：** 软件授权合规、license 检查、开源协议风险、是否需要商业授权

---

### git-history-cleaner

清理 Git 仓库历史中的特定文件或目录以减小仓库体积。

**安装：**
```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list/tree/master/skills/git-history-cleaner
```

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

**安装：**
```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list/tree/master/skills/git-up
```

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

**安装：**
```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list/tree/master/skills/nano-prompt
```

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

## 目录结构

```
ccwq-skill-list/
├── skills/           # Skill 存放目录
├── CLAUDE.md         # 项目配置文档
└── README.md         # 项目说明文档
```

## License

MIT
