#!/usr/bin/env python3
"""git-history-cleaner 的隔离测试脚本。"""

from __future__ import annotations

import argparse
import os
import shutil
import stat
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
SKILL_SCRIPT = PROJECT_ROOT / "skills" / "git-history-cleaner" / "scripts" / "cleaner.py"
RUNTIME_ROOT = ROOT / "runtime"
REPORT_PATH = ROOT / "report.md"


@dataclass
class CommandResult:
    command: list[str]
    cwd: Path
    returncode: int
    stdout: str
    stderr: str


@dataclass
class TestResult:
    name: str
    passed: bool
    summary: str
    details: list[str] = field(default_factory=list)
    commands: list[CommandResult] = field(default_factory=list)


class TestFailure(RuntimeError):
    """测试断言失败。"""


class GitHistoryCleanerTester:
    def __init__(self, cleanup: bool):
        self.cleanup = cleanup
        self.runtime_root = RUNTIME_ROOT
        self.report_path = REPORT_PATH
        self.test_results: list[TestResult] = []
        self.generated_at = datetime.now()
        self.run_id = self.generated_at.strftime("%Y%m%d-%H%M%S")
        self.session_root = self.runtime_root / self.run_id

    def run(self) -> int:
        self.session_root.mkdir(parents=True, exist_ok=True)

        try:
            self.test_results.append(self.test_dry_run_directory())
            self.test_results.append(self.test_clean_directory())
            self.test_results.append(self.test_clean_glob())
            self.write_report()
        finally:
            if self.cleanup:
                self.destroy_runtime()

        return 0 if all(item.passed for item in self.test_results) else 1

    def run_command(self, command: list[str], cwd: Path) -> CommandResult:
        result = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return CommandResult(
            command=command,
            cwd=cwd,
            returncode=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )

    def assert_true(self, condition: bool, message: str):
        if not condition:
            raise TestFailure(message)

    def prepare_case(self, case_name: str) -> tuple[Path, Path]:
        case_root = self.session_root / case_name
        remote_repo = case_root / "internal-remote.git"
        work_repo = case_root / "work-repo"
        case_root.mkdir(parents=True, exist_ok=True)

        init_result = self.run_command(["git", "init", "--bare", str(remote_repo)], PROJECT_ROOT)
        self.assert_true(init_result.returncode == 0, f"初始化 bare repo 失败: {init_result.stderr}")

        clone_result = self.run_command(["git", "clone", str(remote_repo), str(work_repo)], PROJECT_ROOT)
        self.assert_true(clone_result.returncode == 0, f"克隆测试仓库失败: {clone_result.stderr}")

        self.run_checked(["git", "config", "user.name", "Codex Test"], work_repo)
        self.run_checked(["git", "config", "user.email", "codex-test@example.com"], work_repo)

        self.write_file(work_repo / "README.md", "# git-history-cleaner test\n")
        self.git_commit_all(work_repo, "init repo")

        (work_repo / "bin").mkdir(exist_ok=True)
        (work_repo / "nested").mkdir(exist_ok=True)
        self.write_bytes(work_repo / "bin" / "sample.bin", bytes(range(64)) * 4)
        self.git_commit_all(work_repo, "add binary artifact")

        self.write_file(work_repo / "app.log", "transient log\n")
        self.git_commit_all(work_repo, "add log file")

        self.write_file(work_repo / "notes.txt", "keep me\n")
        self.git_commit_all(work_repo, "add notes")

        self.run_checked(["git", "push", "origin", "master"], work_repo)
        return case_root, work_repo

    def run_checked(self, command: list[str], cwd: Path) -> CommandResult:
        result = self.run_command(command, cwd)
        self.assert_true(
            result.returncode == 0,
            f"命令执行失败: {' '.join(command)}\n{result.stderr or result.stdout}",
        )
        return result

    def git_commit_all(self, repo: Path, message: str):
        self.run_checked(["git", "add", "."], repo)
        self.run_checked(["git", "commit", "-m", message], repo)

    def write_file(self, path: Path, content: str):
        path.write_text(content, encoding="utf-8")

    def write_bytes(self, path: Path, content: bytes):
        path.write_bytes(content)

    def run_cleaner(self, repo: Path, pattern: str, extra_args: list[str] | None = None) -> CommandResult:
        command = [sys.executable, str(SKILL_SCRIPT), "--repo", str(repo), "--path", pattern]
        if extra_args:
            command.extend(extra_args)
        return self.run_command(command, PROJECT_ROOT)

    def test_dry_run_directory(self) -> TestResult:
        case_root, work_repo = self.prepare_case("dry-run-directory")
        cleaner = self.run_cleaner(work_repo, "bin/", ["--dry-run", "--auto"])

        try:
            self.assert_true(cleaner.returncode == 0, "dry-run 返回非 0")
            self.assert_true("预览模式不会创建备份" in cleaner.stdout, "dry-run 输出缺少预览提示")
            self.assert_true((work_repo / "bin" / "sample.bin").exists(), "dry-run 后目标文件不应被删除")

            log_result = self.run_checked(["git", "log", "--oneline", "--all", "--", "bin/"], work_repo)
            self.assert_true(log_result.stdout.strip() != "", "dry-run 后历史不应被改写")

            return TestResult(
                name="dry-run 目录模式",
                passed=True,
                summary="`bin/` 预览模式仅分析历史，不创建备份、不删除目标文件。",
                details=[
                    f"测试目录: `{case_root}`",
                    "断言 `bin/sample.bin` 在工作区仍存在。",
                    "断言 `git log --all -- bin/` 仍能查到历史。",
                ],
                commands=[cleaner, log_result],
            )
        except TestFailure as exc:
            return TestResult(
                name="dry-run 目录模式",
                passed=False,
                summary="预览模式行为不符合预期。",
                details=[str(exc)],
                commands=[cleaner],
            )

    def test_clean_directory(self) -> TestResult:
        case_root, work_repo = self.prepare_case("clean-directory")
        cleaner = self.run_cleaner(work_repo, "bin/", ["--auto"])

        log_result = self.run_command(["git", "log", "--oneline", "--all", "--", "bin/"], work_repo)
        tree_result = self.run_command(["git", "ls-tree", "-r", "HEAD"], work_repo)
        status_result = self.run_command(["git", "status", "--short"], work_repo)

        try:
            self.assert_true(cleaner.returncode == 0, "目录清理返回非 0")
            self.assert_true(log_result.stdout.strip() == "", "目录清理后仍能查到 bin/ 历史")
            self.assert_true("bin/sample.bin" not in tree_result.stdout, "目录清理后工作树仍包含目标文件")
            self.assert_true(status_result.stdout.strip() == "", "目录清理后工作区不应脏")

            return TestResult(
                name="真实清理目录模式",
                passed=True,
                summary="`bin/` 历史被正确改写，工作区和提交树中都不再包含目标文件。",
                details=[
                    f"测试目录: `{case_root}`",
                    "断言 `git log --all -- bin/` 为空。",
                    "断言 `git ls-tree -r HEAD` 不再包含 `bin/sample.bin`。",
                    "断言 `git status --short` 为空。",
                ],
                commands=[cleaner, log_result, tree_result, status_result],
            )
        except TestFailure as exc:
            return TestResult(
                name="真实清理目录模式",
                passed=False,
                summary="目录清理未达到预期。",
                details=[str(exc)],
                commands=[cleaner, log_result, tree_result, status_result],
            )

    def test_clean_glob(self) -> TestResult:
        case_root, work_repo = self.prepare_case("clean-glob")
        cleaner = self.run_cleaner(work_repo, "*.log", ["--auto"])

        log_result = self.run_command(["git", "log", "--oneline", "--all", "--", "app.log"], work_repo)
        tree_result = self.run_command(["git", "ls-tree", "-r", "HEAD"], work_repo)
        notes_result = self.run_command(["git", "show", "HEAD:notes.txt"], work_repo)

        try:
            self.assert_true(cleaner.returncode == 0, "glob 清理返回非 0")
            self.assert_true("--path-glob *.log" in cleaner.stdout, "glob 模式未走 path-glob")
            self.assert_true(log_result.stdout.strip() == "", "glob 清理后仍能查到 app.log 历史")
            self.assert_true("app.log" not in tree_result.stdout, "glob 清理后工作树仍包含日志文件")
            self.assert_true(notes_result.returncode == 0 and "keep me" in notes_result.stdout, "非目标文件被误删")

            return TestResult(
                name="真实清理 glob 模式",
                passed=True,
                summary="`*.log` 正确走 `--path-glob` 并移除日志历史，非目标文件保留。",
                details=[
                    f"测试目录: `{case_root}`",
                    "断言执行输出包含 `--path-glob *.log`。",
                    "断言 `app.log` 历史被清空。",
                    "断言 `notes.txt` 仍可从 `HEAD` 读取。",
                ],
                commands=[cleaner, log_result, tree_result, notes_result],
            )
        except TestFailure as exc:
            return TestResult(
                name="真实清理 glob 模式",
                passed=False,
                summary="glob 清理未达到预期。",
                details=[str(exc)],
                commands=[cleaner, log_result, tree_result, notes_result],
            )

    def destroy_runtime(self):
        if self.session_root.exists():
            shutil.rmtree(self.session_root, onexc=self._handle_remove_readonly)

    def _handle_remove_readonly(self, func, path, excinfo):
        _ = excinfo
        os.chmod(path, stat.S_IWRITE)
        func(path)

    def write_report(self):
        passed_count = sum(1 for item in self.test_results if item.passed)
        total_count = len(self.test_results)
        status = "通过" if passed_count == total_count else "失败"

        lines = [
            "# git-history-cleaner 测试报告",
            "",
            f"- 生成时间: `{self.generated_at.isoformat(timespec='seconds')}`",
            f"- 测试脚本: `{Path(__file__).name}`",
            f"- 目标脚本: `{SKILL_SCRIPT.relative_to(PROJECT_ROOT)}`",
            f"- 总体结果: **{status}** ({passed_count}/{total_count})",
            f"- 运行模式: `{'cleanup' if self.cleanup else 'keep-artifacts'}`",
            f"- 本次运行目录: `{self.session_root}`",
            "",
            "## 用例结果",
            "",
        ]

        for item in self.test_results:
            lines.append(f"### {'PASS' if item.passed else 'FAIL'} - {item.name}")
            lines.append("")
            lines.append(item.summary)
            lines.append("")
            for detail in item.details:
                lines.append(f"- {detail}")
            lines.append("")
            lines.append("```text")
            for command in item.commands:
                lines.append(f"$ ({command.cwd}) {' '.join(command.command)}")
                if command.stdout.strip():
                    lines.append(command.stdout.rstrip())
                if command.stderr.strip():
                    lines.append("[stderr]")
                    lines.append(command.stderr.rstrip())
                lines.append("")
            lines.append("```")
            lines.append("")

        lines.extend(
            [
                "## 说明",
                "",
                "- 脚本会为每个用例创建独立的 bare repo 和工作仓库，避免相互污染。",
                "- 每次执行都会写入 `runtime/<timestamp>/`，默认不删除旧运行现场。",
                "- `--cleanup` 模式只会删除当前这一次运行生成的 session 目录。",
                "- 默认模式会保留运行现场，便于手动复查 Git 历史和工作区状态。",
                "",
            ]
        )

        self.report_path.write_text("\n".join(lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="运行 git-history-cleaner 的隔离测试并输出 Markdown 报告。"
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="测试完成后删除 runtime 下的测试仓库。",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    tester = GitHistoryCleanerTester(cleanup=args.cleanup)
    return tester.run()


if __name__ == "__main__":
    raise SystemExit(main())
