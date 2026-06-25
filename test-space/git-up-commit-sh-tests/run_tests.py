#!/usr/bin/env python3
"""Regression tests for git-up commit.sh behavior."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
COMMIT_SH = Path(os.environ.get("COMMIT_SH_PATH", REPO_ROOT / "skills" / "git-up" / "scripts" / "commit.sh"))
WORK_ROOT = REPO_ROOT / "test-space" / "git-up-commit-sh-tests" / "workdir"


def remove_tree(path: Path) -> None:
    def onerror(func, target, _exc_info):
        Path(target).chmod(stat.S_IWRITE)
        func(target)

    if path.exists():
        shutil.rmtree(path, onerror=onerror)


def run(cmd: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        cmd,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if check and result.returncode != 0:
        raise AssertionError(
            f"Command failed: {' '.join(cmd)}\nExit: {result.returncode}\n{result.stdout}"
        )
    return result


def write_plan(repo: Path, files_blob: bytes) -> None:
    artifact_root = Path(run(["git", "rev-parse", "--git-path", "git-up"], repo).stdout.strip())
    plan_id = "b37e"
    plan_dir = repo / artifact_root / plan_id
    plan_dir.mkdir(parents=True)
    (repo / artifact_root / "current").write_text(plan_id + "\n", encoding="utf-8")
    (plan_dir / "manifest.env").write_text(
        "ARTIFACT_VERSION=1\nPLAN_ID=b37e\nSTEP_COUNT=1\n",
        encoding="utf-8",
    )
    (plan_dir / "plan.yaml").write_text(
        """- step: 1
  subject: feat(test): add files
  body: add four files
  foot: ""
  files:
    - a.txt
    - b.txt
    - c.txt
    - d.txt
""",
        encoding="utf-8",
    )
    for file_name, cmd in [
        ("staged.diff", ["git", "diff", "--cached"]),
        ("worktree.diff", ["git", "diff"]),
        ("status.txt", ["git", "status", "--short", "-uall"]),
    ]:
        (plan_dir / file_name).write_text(run(cmd, repo).stdout, encoding="utf-8")
    (plan_dir / "step-1.msg").write_text(
        "feat(test): add files\n\n- add four files\n",
        encoding="utf-8",
    )
    (plan_dir / "step-1.files").write_bytes(files_blob)


def make_repo(name: str, files_blob: bytes) -> Path:
    repo = WORK_ROOT / name
    remove_tree(repo)
    repo.mkdir(parents=True)
    shutil.copy2(COMMIT_SH, repo / "commit.sh")
    run(["git", "init"], repo)
    run(["git", "config", "user.name", "tester"], repo)
    run(["git", "config", "user.email", "tester@example.com"], repo)
    for filename in ["a.txt", "b.txt", "c.txt", "d.txt"]:
        (repo / filename).write_text(f"{filename}\n", encoding="utf-8")
    write_plan(repo, files_blob)
    return repo


def assert_all_planned_files_committed(repo: Path) -> None:
    script = run(["sh", "./commit.sh"], repo, check=False)
    if script.returncode != 0:
        raise AssertionError(f"commit.sh failed unexpectedly:\n{script.stdout}")
    show = run(["git", "show", "--name-only", "--oneline", "HEAD"], repo).stdout
    status = run(["git", "status", "--short", "-uall"], repo).stdout
    for filename in ["a.txt", "b.txt", "c.txt", "d.txt"]:
        if filename not in show:
            raise AssertionError(
                f"{filename} missing from HEAD\n--- commit output ---\n{script.stdout}"
                f"--- git show ---\n{show}--- status ---\n{status}"
            )
        if filename in status:
            raise AssertionError(f"{filename} still present in status after commit:\n{status}")


def test_step_files_without_final_newline_commits_last_file() -> None:
    """
    Given：step-N.files 包含 4 个计划文件，且最后一行 d.txt 没有结尾换行。
    When：通过公开入口 sh ./commit.sh 执行 git-up 提交脚本。
    Then：4 个文件都进入 HEAD，工作区不残留 d.txt。
    防回归：避免 POSIX read 在末行无换行时返回非 0，导致循环体跳过最后一个文件。
    """
    repo = make_repo("no-final-newline", b"a.txt\nb.txt\nc.txt\nd.txt")
    assert_all_planned_files_committed(repo)


def test_step_files_with_final_newline_still_commits_all_files() -> None:
    """
    Given：step-N.files 使用常规 LF 格式，最后一行带结尾换行。
    When：通过公开入口 sh ./commit.sh 执行 git-up 提交脚本。
    Then：4 个文件都进入 HEAD，工作区不残留计划内文件。
    防回归：修复末行无换行问题时不能破坏普通换行格式的文件清单。
    """
    repo = make_repo("with-final-newline", b"a.txt\nb.txt\nc.txt\nd.txt\n")
    assert_all_planned_files_committed(repo)


def main() -> int:
    tests = [
        test_step_files_without_final_newline_commits_last_file,
        test_step_files_with_final_newline_still_commits_all_files,
    ]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as exc:  # noqa: BLE001 - simple script runner
            failed += 1
            print(f"FAIL {test.__name__}")
            print(exc)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
