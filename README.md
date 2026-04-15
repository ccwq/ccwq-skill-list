# Claude Code Skill 仓库

本仓库用于存放和管理 Claude Code 的自定义 Skill。

https://github.com/ccwq/ccwq-skill-list

## 快速开始

### 安装 Skill

安装单个 Skill：

```bash
npx -y skills add https://github.com/ccwq/ccwq-skill-list/tree/master/skills/software-license-checker
```

安装后可在对话中显式使用：

```text
$software-license-checker 检查 FFmpeg 是否可以在企业内部使用
```

### 安装内容说明

当前仓库提供的 Skill 安装后会包含该 Skill 目录下的全部内容，例如：

- `SKILL.md`：Skill 的触发描述与执行说明
- `agents/openai.yaml`：Skill 的 UI 元数据与默认提示
- `references/`：按需加载的参考资料
- `scripts/`：如果某个 Skill 提供脚本，也会一并安装
- `assets/`：如果某个 Skill 提供模板或资源文件，也会一并安装

以 `software-license-checker` 为例，安装内容包括：

- `SKILL.md`
- `agents/openai.yaml`
- `references/source-priority.md`
- `references/internal-use-risk-rubric.md`



### 可用 Skill

- `software-license-checker`
  用于评估软件在企业内部使用场景下的许可证与授权合规风险，输出偏保守的法务预警报告。

## 目录结构

```
ccwq-skill-list/
├── skills/           # Skill 存放目录
├── CLAUDE.md         # 项目配置文档
└── README.md         # 项目说明文档
```

## License

MIT
