# Ignore 规则

`-i` 不是提交模式。它按 `package.json`、`pyproject.toml` 或 `requirements.txt` 识别 Node.js/Python，并增量维护 `.gitignore`；用户可显式传 `node python` 限缩技术栈。

- 每个新增组使用 `# Git-up：...` 中文说明。
- 默认不添加 `.env`/`.env.*`；用户必须以 `--add <规则> --reason <原因>` 显式请求。
- 已有等价规则跳过，保留手写内容。
- `--dry-run` 只展示结果。
- `--clean` 只预览 Git-up 管理区块的重复规则；仅 `--clean --apply` 删除，且不删除手写规则。

```powershell
python skills/git-up/scripts/gitignore_manager.py --cwd .
python skills/git-up/scripts/gitignore_manager.py --cwd . node python
python skills/git-up/scripts/gitignore_manager.py --cwd . --add "tmp/" --reason "本地调试输出"
python skills/git-up/scripts/gitignore_manager.py --cwd . --clean
```
