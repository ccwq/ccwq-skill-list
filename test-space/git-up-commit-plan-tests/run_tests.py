#!/usr/bin/env python3
"""git-up commit_plan.py 的轻量回归测试。"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
SCRIPT = PROJECT_ROOT / "skills" / "git-up" / "scripts" / "commit_plan.py"


class TestFailure(AssertionError):
    """测试断言失败。"""


def run_command(command: list[str], cwd: Path, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        input=stdin,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def assert_true(condition: bool, message: str):
    if not condition:
        raise TestFailure(message)


def parse_json(result: subprocess.CompletedProcess[str]) -> dict[str, object]:
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise TestFailure(f"输出不是合法 JSON: {result.stdout}") from exc


def run_plan(mode: str, yaml_text: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    command = [sys.executable, str(SCRIPT), mode]
    if cwd is not None:
        command.extend(["--cwd", str(cwd)])
    return run_command(command, PROJECT_ROOT, yaml_text)


def init_repo(repo: Path):
    run_command(["git", "init"], repo)
    run_command(["git", "config", "user.name", "Codex Test"], repo)
    run_command(["git", "config", "user.email", "codex-test@example.com"], repo)
    (repo / "README.md").write_text("# test\n", encoding="utf-8")
    run_command(["git", "add", "README.md"], repo)
    run_command(["git", "commit", "-m", "init"], repo)


def test_parse_full_plan():
    """
    Given：git-up -p 输出包含 subject、body、foot、files 的固定 YAML 子集。
    When：commit_plan.py parse 从 stdin 读取并解析计划。
    Then：返回 ok=true，且多行 body 与 files 列表被正确保留。
    防回归：避免 YAML Lite parser 破坏常见提交正文和文件列表。
    """
    yaml_text = """- step: 1
  subject: "feat(skill): add parser"
  body: |
    - parse yaml-lite
    - execute git plan
  foot: "Refs: #1"
  files:
    - skills/git-up/SKILL.md
    - skills/git-up/scripts/commit_plan.py
"""
    result = run_plan("parse", yaml_text)
    payload = parse_json(result)
    assert_true(result.returncode == 0, result.stderr or result.stdout)
    assert_true(payload["ok"] is True, "解析应成功")
    step = payload["steps"][0]
    assert_true("parse yaml-lite" in step["body"], "多行 body 应保留")
    assert_true(len(step["files"]) == 2, "files 应包含两个路径")


def test_parse_optional_body_and_foot():
    """
    Given：计划只包含 step、subject 和 files，省略 body 与 foot。
    When：commit_plan.py parse 解析该最小有效计划。
    Then：返回 ok=true，body 和 foot 使用空字符串默认值。
    防回归：保证可选字段缺失不会误判为语法错误。
    """
    yaml_text = """- step: 1
  subject: "docs(readme): update usage"
  files:
    - README.md
"""
    result = run_plan("parse", yaml_text)
    payload = parse_json(result)
    assert_true(result.returncode == 0, result.stderr or result.stdout)
    step = payload["steps"][0]
    assert_true(step["body"] == "", "body 缺失时应为空")
    assert_true(step["foot"] == "", "foot 缺失时应为空")


def test_missing_files_fails():
    """
    Given：计划 step 缺少 files 安全边界字段。
    When：commit_plan.py parse 校验该计划。
    Then：返回 code=missing_files 且非 0，供 LLM 修复 YAML 后重试。
    防回归：禁止执行器在 files 缺失时猜测路径或 git add .。
    """
    yaml_text = """- step: 1
  subject: "fix(core): avoid unsafe add"
"""
    result = run_plan("parse", yaml_text)
    payload = parse_json(result)
    assert_true(result.returncode == 2, "缺 files 应返回解析错误码 2")
    assert_true(payload["code"] == "missing_files", "错误码应可被 LLM 识别")


def test_commit_plan_executes_only_planned_files():
    """
    Given：仓库里同时存在计划内文件和计划外未跟踪文件。
    When：commit_plan.py commit 执行只列出计划内文件的提交计划。
    Then：只提交计划内文件，计划外文件仍保持未跟踪状态。
    防回归：确保 Python fast path 延续 git-up 只 add 显式 files 的安全约束。
    """
    with tempfile.TemporaryDirectory(prefix="git-up-plan-") as tmp:
        repo = Path(tmp)
        init_repo(repo)
        (repo / "planned.txt").write_text("planned\n", encoding="utf-8")
        (repo / "unplanned.txt").write_text("unplanned\n", encoding="utf-8")
        yaml_text = """- step: 1
  subject: "test(plan): commit planned file"
  files:
    - planned.txt
"""
        result = run_plan("commit", yaml_text, repo)
        payload = parse_json(result)
        status = run_command(["git", "status", "--short"], repo)
        committed = run_command(["git", "show", "--name-only", "--format=", "HEAD"], repo)
        assert_true(result.returncode == 0, result.stdout)
        assert_true(payload["ok"] is True, "提交应成功")
        assert_true("planned.txt" in committed.stdout, "计划内文件应进入提交")
        assert_true("?? unplanned.txt" in status.stdout, "计划外文件应保持未跟踪")


def test_commit_refuses_pre_staged_changes():
    """
    Given：执行前 index 已有暂存文件，存在提交计划外内容风险。
    When：commit_plan.py commit 执行任意计划。
    Then：返回 staged_changes_present，且不创建新提交。
    防回归：避免 fast path 把用户已有 staged 内容混入计划提交。
    """
    with tempfile.TemporaryDirectory(prefix="git-up-staged-") as tmp:
        repo = Path(tmp)
        init_repo(repo)
        (repo / "staged.txt").write_text("staged\n", encoding="utf-8")
        (repo / "planned.txt").write_text("planned\n", encoding="utf-8")
        run_command(["git", "add", "staged.txt"], repo)
        before = run_command(["git", "rev-parse", "HEAD"], repo).stdout.strip()
        yaml_text = """- step: 1
  subject: "test(plan): commit planned file"
  files:
    - planned.txt
"""
        result = run_plan("commit", yaml_text, repo)
        payload = parse_json(result)
        after = run_command(["git", "rev-parse", "HEAD"], repo).stdout.strip()
        assert_true(result.returncode == 1, "已有 staged 内容时应拒绝执行")
        assert_true(payload["code"] == "staged_changes_present", "错误码应说明 staged 冲突")
        assert_true(before == after, "拒绝执行时不应产生新提交")


def main() -> int:
    tests = [
        test_parse_full_plan,
        test_parse_optional_body_and_foot,
        test_missing_files_fails,
        test_commit_plan_executes_only_planned_files,
        test_commit_refuses_pre_staged_changes,
    ]
    failures: list[str] = []
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as exc:  # noqa: BLE001 - keep test runner dependency-free.
            failures.append(f"FAIL {test.__name__}: {exc}")
            print(failures[-1])

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
