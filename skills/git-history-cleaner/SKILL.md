---
name: git-history-cleaner
description: |
  清理 Git 仓库历史中的特定文件或目录以减小仓库体积，或移除误提交到历史中的敏感/二进制文件。用户提到以下需求时使用：
  - "清理 git 仓库"、"减小仓库大小"、"清理历史文件"
  - "删除 git 历史中的大文件"、"清理 bin/ 目录历史"
  - "git filter-repo"、"BFG 清理"
  - "仓库太大"、"reduce repo size"、"clean up git history"
  - 任何涉及删除 Git 历史记录中特定文件、目录或 glob 模式文件的需求
---

# Git History Cleaner

清理 Git 仓库历史中的特定文件，支持预览、确认和自动三种执行方式。

## 执行流程

1. 确认仓库路径和清理目标
2. 分析匹配文件在历史中的分布
3. 确认是否改写历史
4. 创建 `.git` 备份
5. 执行 `git filter-repo`
6. 输出后续推送和协作提示

## 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--repo` | 仓库路径 | 当前目录 |
| `--path` | 要删除的路径模式。支持目录（如 `bin/`）、精确路径（如 `secrets.txt`）和 glob（如 `*.log`） | 必填 |
| `--dry-run` | 只分析历史，不创建备份、不改写历史 | false |
| `--auto` | 自动模式，无需确认 | false |

## 使用示例

```bash
# 交互模式
python scripts/cleaner.py --repo /path/to/repo --path bin/

# 自动模式
python scripts/cleaner.py --repo /path/to/repo --path "*.log" --auto

# 预览模式
python scripts/cleaner.py --repo /path/to/repo --path bin/ --dry-run
```

## 脚本说明

核心逻辑位于 `scripts/cleaner.py`：

- `analyze_history()`：分析历史中受影响的提交、文件和大小
- `build_filter_repo_cmd()`：根据目录、精确路径或 glob 模式构建 `git filter-repo` 命令
- `create_backup()`：备份 `.git` 目录
- `execute_clean()`：执行历史改写
- `restore_backup()`：清理失败时恢复备份

## 使用要求

- 在执行前确认 `git filter-repo` 可用；脚本会检查 `git filter-repo --version`
- 在预览模式下只读取历史，不改写仓库
- 在实际执行前保留 `.git` 备份，避免误操作无法回滚
- 在检测到远程仓库时，提醒用户后续手动执行 `git push --force`
- 在 Windows 上按正常路径输入即可，脚本会自行兼容 `/` 与 `\`

## 注意事项

- 改写历史会改变提交 ID，协作者通常需要重新克隆仓库
- `git filter-repo` 会直接删除匹配路径的全部历史，不会保留部分版本
- 如果用户明确要求“保留最近几个版本”，先说明此 skill 当前不支持，应改用定制化清理方案
