# git-history-cleaner 测试报告

- 生成时间: `2026-04-15T18:57:38`
- 测试脚本: `run_tests.py`
- 目标脚本: `skills\git-history-cleaner\scripts\cleaner.py`
- 总体结果: **通过** (3/3)
- 运行模式: `keep-artifacts`
- 本次运行目录: `E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738`

## 用例结果

### PASS - dry-run 目录模式

`bin/` 预览模式仅分析历史，不创建备份、不删除目标文件。

- 测试目录: `E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\dry-run-directory`
- 断言 `bin/sample.bin` 在工作区仍存在。
- 断言 `git log --all -- bin/` 仍能查到历史。

```text
$ (E:\project\self.project\ccwq-skill-list) D:\ProgramData\miniforge3\python.exe E:\project\self.project\ccwq-skill-list\skills\git-history-cleaner\scripts\cleaner.py --repo E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\dry-run-directory\work-repo --path bin/ --dry-run --auto

🚀 Git History Cleaner
============================================================
   仓库路径: E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\dry-run-directory\work-repo
   文件模式: bin/
   预览模式: True
   自动模式: True

============================================================
📊 分析历史中的文件: bin/
============================================================

📈 分析结果:
   影响提交数: 1
   匹配文件数: 1
   总大小: 0.00 MB

📁 最近修改的文件 (前10个):
   1. [3115f2a1] bin/sample.bin (0.2 KB)

ℹ️  预览模式不会创建备份，也不会改写历史

$ (E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\dry-run-directory\work-repo) git log --oneline --all -- bin/
3115f2a add binary artifact

```

### PASS - 真实清理目录模式

`bin/` 历史被正确改写，工作区和提交树中都不再包含目标文件。

- 测试目录: `E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-directory`
- 断言 `git log --all -- bin/` 为空。
- 断言 `git ls-tree -r HEAD` 不再包含 `bin/sample.bin`。
- 断言 `git status --short` 为空。

```text
$ (E:\project\self.project\ccwq-skill-list) D:\ProgramData\miniforge3\python.exe E:\project\self.project\ccwq-skill-list\skills\git-history-cleaner\scripts\cleaner.py --repo E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-directory\work-repo --path bin/ --auto

🚀 Git History Cleaner
============================================================
   仓库路径: E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-directory\work-repo
   文件模式: bin/
   预览模式: False
   自动模式: True

============================================================
📊 分析历史中的文件: bin/
============================================================

📈 分析结果:
   影响提交数: 1
   匹配文件数: 1
   总大小: 0.00 MB

📁 最近修改的文件 (前10个):
   1. [59ead217] bin/sample.bin (0.2 KB)

============================================================
💾 创建备份
============================================================
   备份路径: C:\Users\ADMINI~1\AppData\Local\Temp\git_backup_20260415_185743
   正在复制 .git 目录...
   ✅ 备份完成

============================================================
🧹 执行清理
============================================================
   ⚠️  检测到远程仓库:
      origin	E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-directory\internal-remote.git (fetch)
      origin	E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-directory\internal-remote.git (push)
   ⚠️  清理后需要手动执行: git push --force

   执行命令: git filter-repo --path bin/ --invert-paths --force
   工作目录: E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-directory\work-repo
   ✅ 清理完成

============================================================
✅ 清理完成
============================================================

   备份仍保留在: C:\Users\ADMINI~1\AppData\Local\Temp\git_backup_20260415_185743
   确认无误后可手动删除

$ (E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-directory\work-repo) git log --oneline --all -- bin/

$ (E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-directory\work-repo) git ls-tree -r HEAD
100644 blob fcd85e76ef85e065d136a4be2cc461d21401cf3c	README.md
100644 blob c22efb1f5e113fefa65949022989cd453bd858ef	app.log
100644 blob e0808fa1636ba0f6c16048fd3292ecbe55078dd0	notes.txt

$ (E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-directory\work-repo) git status --short

```

### PASS - 真实清理 glob 模式

`*.log` 正确走 `--path-glob` 并移除日志历史，非目标文件保留。

- 测试目录: `E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-glob`
- 断言执行输出包含 `--path-glob *.log`。
- 断言 `app.log` 历史被清空。
- 断言 `notes.txt` 仍可从 `HEAD` 读取。

```text
$ (E:\project\self.project\ccwq-skill-list) D:\ProgramData\miniforge3\python.exe E:\project\self.project\ccwq-skill-list\skills\git-history-cleaner\scripts\cleaner.py --repo E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-glob\work-repo --path *.log --auto

🚀 Git History Cleaner
============================================================
   仓库路径: E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-glob\work-repo
   文件模式: *.log
   预览模式: False
   自动模式: True

============================================================
📊 分析历史中的文件: *.log
============================================================

📈 分析结果:
   影响提交数: 1
   匹配文件数: 1
   总大小: 0.00 MB

📁 最近修改的文件 (前10个):
   1. [aa19d86f] app.log (0.0 KB)

============================================================
💾 创建备份
============================================================
   备份路径: C:\Users\ADMINI~1\AppData\Local\Temp\git_backup_20260415_185746
   正在复制 .git 目录...
   ✅ 备份完成

============================================================
🧹 执行清理
============================================================
   ⚠️  检测到远程仓库:
      origin	E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-glob\internal-remote.git (fetch)
      origin	E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-glob\internal-remote.git (push)
   ⚠️  清理后需要手动执行: git push --force

   执行命令: git filter-repo --path-glob *.log --invert-paths --force
   工作目录: E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-glob\work-repo
   ✅ 清理完成

============================================================
✅ 清理完成
============================================================

   备份仍保留在: C:\Users\ADMINI~1\AppData\Local\Temp\git_backup_20260415_185746
   确认无误后可手动删除

$ (E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-glob\work-repo) git log --oneline --all -- app.log

$ (E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-glob\work-repo) git ls-tree -r HEAD
100644 blob fcd85e76ef85e065d136a4be2cc461d21401cf3c	README.md
100644 blob e656071b61bb21a84db01f6659ac444db1915e3f	bin/sample.bin
100644 blob e0808fa1636ba0f6c16048fd3292ecbe55078dd0	notes.txt

$ (E:\project\self.project\ccwq-skill-list\test-space\git-history-cleaner\runtime\20260415-185738\clean-glob\work-repo) git show HEAD:notes.txt
keep me

```

## 说明

- 脚本会为每个用例创建独立的 bare repo 和工作仓库，避免相互污染。
- 每次执行都会写入 `runtime/<timestamp>/`，默认不删除旧运行现场。
- `--cleanup` 模式只会删除当前这一次运行生成的 session 目录。
- 默认模式会保留运行现场，便于手动复查 Git 历史和工作区状态。
