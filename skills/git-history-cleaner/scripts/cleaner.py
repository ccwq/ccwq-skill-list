#!/usr/bin/env python3
"""
Git History Cleaner - 清理 Git 仓库历史中的特定文件

用法:
    python cleaner.py --repo <仓库路径> --path <文件模式> [--dry-run] [--auto]

示例:
    python cleaner.py --repo . --path bin/
    python cleaner.py --repo . --path "*.exe" --dry-run
    python cleaner.py --repo . --path "*.log" --auto
"""

import argparse
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional


class GitHistoryCleaner:
    """Git 历史清理器"""

    def __init__(self, repo_path: str, file_pattern: str,
                 dry_run: bool = False, auto: bool = False):
        self.repo_path = Path(repo_path).resolve()
        self.file_pattern = file_pattern
        self.dry_run = dry_run
        self.auto = auto
        self.backup_dir: Optional[Path] = None

        # 优先调用 `git filter-repo` 子命令，兼容常见安装方式。
        try:
            subprocess.run(
                ['git', 'filter-repo', '--version'],
                capture_output=True,
                text=True,
                check=True
            )
        except (subprocess.CalledProcessError, FileNotFoundError):
            raise RuntimeError(
                "git-filter-repo 未安装。请运行: pip install git-filter-repo"
            )

    def run_git(self, *args, capture=True, check=True):
        """执行 git 命令"""
        cmd = ['git'] + list(args)
        result = subprocess.run(
            cmd,
            cwd=self.repo_path,
            capture_output=capture,
            text=True
        )
        if check and result.returncode != 0:
            raise RuntimeError(f"Git 命令失败: {' '.join(cmd)}\n{result.stderr}")
        return result

    def analyze_history(self) -> dict:
        """
        分析历史中匹配文件的分布

        返回:
            dict: {
                'files_found': list of {'commit': str, 'file': str, 'size': int},
                'total_size': int,
                'commits_affected': int
            }
        """
        print(f"\n{'=' * 60}")
        print(f"📊 分析历史中的文件: {self.file_pattern}")
        print(f"{'=' * 60}")

        # 直接遍历历史中的改动文件，再按 skill 支持的模式进行匹配，
        # 这样目录和 glob 模式都能稳定工作。
        result = self.run_git(
            'log', '--all', '--name-only', '--pretty=format:%H|%s'
        )

        commits = {}
        current_commit = None
        for raw_line in result.stdout.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if '|' in line:
                commit_hash, msg = line.split('|', 1)
                current_commit = commit_hash
                commits[current_commit] = {'msg': msg, 'files': []}
                continue
            if current_commit and self._match_pattern(line):
                commits[current_commit]['files'].append(line)

        files_with_size = []
        for commit, data in commits.items():
            for file_path in data['files']:
                files_with_size.append({
                    'commit': commit,
                    'file': file_path,
                    'msg': data['msg'],
                    'size': self.get_blob_size(commit, file_path)
                })

        total_size = sum(item['size'] for item in files_with_size)
        unique_commits = len({item['commit'] for item in files_with_size})

        return {
            'files_found': files_with_size,
            'total_size': total_size,
            'total_size_mb': total_size / (1024 * 1024),
            'commits_affected': unique_commits
        }

    def _match_pattern(self, filename: str) -> bool:
        """检查文件名是否匹配模式"""
        import fnmatch

        pattern = self.file_pattern.replace('\\', '/')
        normalized = filename.replace('\\', '/')

        if pattern.endswith('/'):
            return normalized.startswith(pattern)

        if any(char in pattern for char in '*?['):
            return fnmatch.fnmatch(normalized, pattern) or fnmatch.fnmatch(
                os.path.basename(normalized), pattern
            )

        return normalized == pattern or os.path.basename(normalized) == pattern

    def get_blob_size(self, commit: str, file_path: str) -> int:
        """读取指定提交中文件 blob 的实际大小"""
        spec = f'{commit}:{file_path}'
        result = self.run_git('cat-file', '-s', spec, check=False)
        if result.returncode != 0:
            return 0
        try:
            return int(result.stdout.strip())
        except ValueError:
            return 0

    def print_analysis(self, analysis: dict):
        """打印分析结果"""
        print(f"\n📈 分析结果:")
        print(f"   影响提交数: {analysis['commits_affected']}")
        print(f"   匹配文件数: {len(analysis['files_found'])}")
        print(f"   总大小: {analysis['total_size_mb']:.2f} MB")

        if analysis['files_found']:
            print(f"\n📁 最近修改的文件 (前10个):")
            for i, item in enumerate(analysis['files_found'][:10], start=1):
                print(
                    f"   {i}. [{item['commit'][:8]}] {item['file']} "
                    f"({item['size'] / 1024:.1f} KB)"
                )

    def create_backup(self) -> Path:
        """创建临时备份"""
        print(f"\n{'=' * 60}")
        print("💾 创建备份")
        print(f"{'=' * 60}")

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_name = f"git_backup_{timestamp}"
        self.backup_dir = Path(tempfile.gettempdir()) / backup_name

        print(f"   备份路径: {self.backup_dir}")
        print("   正在复制 .git 目录...")

        shutil.copytree(self.repo_path / '.git', self.backup_dir / '.git')

        print("   ✅ 备份完成")
        return self.backup_dir

    def list_remotes(self) -> list[str]:
        """读取远程仓库列表"""
        result = self.run_git('remote', '-v', check=False)
        if result.returncode != 0:
            return []
        return [line for line in result.stdout.splitlines() if line.strip()]

    def build_filter_repo_cmd(self) -> list[str]:
        """根据路径模式构造 filter-repo 命令"""
        pattern = self.file_pattern.replace('\\', '/')
        cmd = ['git', 'filter-repo']

        if pattern.endswith('/'):
            cmd.extend(['--path', pattern])
        elif any(char in pattern for char in '*?['):
            cmd.extend(['--path-glob', pattern])
        else:
            cmd.extend(['--path', pattern])

        cmd.extend(['--invert-paths', '--force'])
        return cmd

    def execute_clean(self) -> bool:
        """
        执行清理

        返回:
            bool: 是否成功
        """
        print(f"\n{'=' * 60}")
        print("🧹 执行清理")
        print(f"{'=' * 60}")

        remotes = self.list_remotes()
        if remotes:
            print("   ⚠️  检测到远程仓库:")
            for line in remotes:
                print(f"      {line}")
            print("   ⚠️  清理后需要手动执行: git push --force")
        else:
            print("   ℹ️  未检测到远程仓库")

        cmd = self.build_filter_repo_cmd()
        print(f"\n   执行命令: {' '.join(cmd)}")
        print(f"   工作目录: {self.repo_path}")

        result = subprocess.run(
            cmd,
            cwd=self.repo_path,
            capture_output=True,
            text=True
        )

        if result.returncode != 0:
            print("   ❌ 清理失败:")
            stderr = result.stderr.strip() or '(无错误输出)'
            print(f"      {stderr}")
            return False

        print("   ✅ 清理完成")
        return True

    def _handle_remove_readonly(self, func, path, excinfo):
        """删除 Windows 只读文件时回调重试"""
        _ = excinfo
        os.chmod(path, stat.S_IWRITE)
        func(path)

    def remove_tree(self, path: Path):
        """删除目录树，并尽量兼容 Windows 只读文件"""
        if path.exists():
            shutil.rmtree(path, onexc=self._handle_remove_readonly)

    def restore_backup(self):
        """恢复备份"""
        if not self.backup_dir or not self.backup_dir.exists():
            print("   ℹ️  没有备份需要恢复")
            return

        print(f"\n{'=' * 60}")
        print("🔄 恢复备份")
        print(f"{'=' * 60}")

        current_git = self.repo_path / '.git'
        self.remove_tree(current_git)
        shutil.copytree(self.backup_dir / '.git', current_git)
        print("   ✅ 备份已恢复")

    def cleanup_backup(self):
        """清理备份"""
        if not self.backup_dir or not self.backup_dir.exists():
            return

        print(f"\n{'=' * 60}")
        print("🗑️  清理备份")
        print(f"{'=' * 60}")

        self.remove_tree(self.backup_dir)
        print(f"   ✅ 备份已清理: {self.backup_dir}")

    def confirm_action(self, message: str) -> bool:
        """请求用户确认"""
        if self.auto:
            return True

        print(f"\n{message}")
        while True:
            response = input("   请输入 (y/n/a): ").strip().lower()
            if response == 'y':
                return True
            if response == 'n':
                return False
            if response == 'a':
                self.auto = True
                return True
            print("   无效输入，请输入 y(是) / n(否) / a(全部自动)")

    def run(self):
        """运行完整的清理流程"""
        print("\n🚀 Git History Cleaner")
        print(f"{'=' * 60}")
        print(f"   仓库路径: {self.repo_path}")
        print(f"   文件模式: {self.file_pattern}")
        print(f"   预览模式: {self.dry_run}")
        print(f"   自动模式: {self.auto}")

        if not (self.repo_path / '.git').exists():
            print(f"\n❌ 错误: {self.repo_path} 不是 Git 仓库")
            return False

        analysis = self.analyze_history()
        self.print_analysis(analysis)

        if analysis['commits_affected'] == 0:
            print("\n✅ 没有找到匹配的文件，无需清理")
            return True

        if self.dry_run:
            print("\nℹ️  预览模式不会创建备份，也不会改写历史")
            return True

        if not self.confirm_action(
            f"\n确认删除历史中所有匹配的 {self.file_pattern} 文件？\n"
            f"   这将影响 {analysis['commits_affected']} 个提交\n"
            f"   总计约 {analysis['total_size_mb']:.2f} MB"
        ):
            print("\n👋 已取消操作")
            return False

        backup_dir = self.create_backup()

        try:
            success = self.execute_clean()
            if not success:
                if self.confirm_action("\n清理失败，是否恢复备份？"):
                    self.restore_backup()
                return False

            print(f"\n{'=' * 60}")
            print("✅ 清理完成")
            print(f"{'=' * 60}")

            remotes = self.list_remotes()
            if remotes:
                print("\n📌 下一步操作:")
                print("   1. 检查仓库状态: git status")
                print("   2. 强制推送: git push --force")
                print("   3. 通知协作者重新克隆")

            print(f"\n   备份仍保留在: {backup_dir}")
            print("   确认无误后可手动删除")
            return True

        except KeyboardInterrupt:
            print("\n\n⚠️  操作被中断")
            if self.confirm_action("是否恢复备份？"):
                self.restore_backup()
            return False

        except Exception as exc:
            print(f"\n❌ 错误: {exc}")
            if self.confirm_action("是否恢复备份？"):
                self.restore_backup()
            return False


def main():
    parser = argparse.ArgumentParser(
        description='清理 Git 仓库历史中的特定文件',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    parser.add_argument('--repo', '-r', default='.',
                        help='仓库路径 (默认: 当前目录)')
    parser.add_argument('--path', '-p', required=True,
                        help='要删除的文件/目录模式 (支持目录和 glob)')
    parser.add_argument('--dry-run', '-d', action='store_true',
                        help='预览模式，只分析不执行')
    parser.add_argument('--auto', '-a', action='store_true',
                        help='自动模式，无需确认')

    args = parser.parse_args()

    try:
        cleaner = GitHistoryCleaner(
            repo_path=args.repo,
            file_pattern=args.path,
            dry_run=args.dry_run,
            auto=args.auto
        )
        success = cleaner.run()
        sys.exit(0 if success else 1)
    except RuntimeError as exc:
        print(f"\n❌ {exc}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n\n👋 已取消")
        sys.exit(130)


if __name__ == '__main__':
    main()
