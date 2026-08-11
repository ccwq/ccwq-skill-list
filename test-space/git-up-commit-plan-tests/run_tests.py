#!/usr/bin/env python3
"""git-up commit_plan.py 的轻量回归测试。"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
SCRIPT = PROJECT_ROOT / "skills" / "git-up" / "scripts" / "commit_plan.py"
IGNORE_SCRIPT = PROJECT_ROOT / "skills" / "git-up" / "scripts" / "gitignore_manager.py"


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


def run_shell_pipe(shell: str, producer_script: str, yaml_text: str) -> subprocess.CompletedProcess[str]:
    """通过指定 shell 产出计划字节，再交给 commit_plan.py 解析。"""
    environment = dict(os.environ, GIT_UP_PLAN=yaml_text)
    producer = subprocess.Popen(
        [shell, "-NoProfile", "-NonInteractive", "-Command", producer_script]
        if Path(shell).name.lower() == "powershell.exe"
        else [shell, "-lc", producer_script],
        cwd=PROJECT_ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert producer.stdout is not None
    consumer = subprocess.Popen(
        [sys.executable, str(SCRIPT), "parse"],
        cwd=PROJECT_ROOT,
        stdin=producer.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    producer.stdout.close()
    consumer_stdout, consumer_stderr = consumer.communicate()
    producer.wait()
    producer_stderr = producer.stderr.read() if producer.stderr is not None else b""
    stderr = "".join(
        part.decode("utf-8", errors="replace") if isinstance(part, bytes) else part
        for part in (producer_stderr, consumer_stderr)
    )
    if producer.returncode != 0 and not stderr:
        stderr = f"shell producer exited with code {producer.returncode}"
    return subprocess.CompletedProcess(
        [shell, producer_script],
        consumer.returncode if consumer.returncode != 0 else producer.returncode,
        consumer_stdout,
        stderr,
    )


def powershell_path() -> str:
    command = shutil.which("powershell")
    if not command:
        raise TestFailure("找不到 Windows PowerShell，无法验证 PowerShell 管道输入")
    return command


def git_bash_path() -> str:
    command = shutil.which("bash")
    if not command:
        raise TestFailure("找不到 Git Bash，无法验证 printf 管道输入")
    return command


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


def run_plan_file(mode: str, yaml_text: str) -> subprocess.CompletedProcess[str]:
    """Write the plan as UTF-8 bytes, then execute the file-input path."""
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", delete=False) as handle:
        handle.write(yaml_text)
        plan_path = Path(handle.name)
    try:
        return run_command(
            [sys.executable, str(SCRIPT), mode, "--plan-file", str(plan_path)],
            PROJECT_ROOT,
        )
    finally:
        plan_path.unlink(missing_ok=True)


def run_ignore(arguments: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return run_command([sys.executable, str(IGNORE_SCRIPT), "--cwd", str(cwd), *arguments], PROJECT_ROOT)


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


def test_plan_file_preserves_utf8_plan_variants():
    """
    Given: a UTF-8 plan file contains Chinese text and emoji.
    When: commit_plan.py parses with --plan-file.
    Then: the original non-ASCII characters remain intact.
    Regression: avoid Windows PowerShell native-pipeline replacement with '?'.
    """
    yaml_text = """- step: 1
  subject: "修复：解析计划 ✅"
  body: "保留中文和 emoji"
  files:
    - 中文.txt
"""
    result = run_plan_file("parse", yaml_text)
    payload = parse_json(result)
    assert_true(result.returncode == 0, result.stderr or result.stdout)
    assert_true(payload["ok"] is True, "UTF-8 plan file should parse")
    step = payload["steps"][0]
    assert_true(step["subject"] == "修复：解析计划 ✅", "subject must preserve UTF-8")
    assert_true(step["body"] == "保留中文和 emoji", "body must preserve UTF-8")
    assert_true(step["files"] == ["中文.txt"], "file paths must preserve UTF-8")


def test_powershell_pipe_preserves_utf8_plan_variants():
    """
    Given：PowerShell 管道输出带 UTF-8 BOM 的 ASCII、中文和 emoji 计划。
    When：commit_plan.py parse 从该管道读取计划。
    Then：每种合法计划都能成功解析，非法计划仍返回内容校验错误。
    防回归：区分 PowerShell 编码边界问题与计划自身的结构错误。
    """
    shell = powershell_path()
    producer_script = (
        "$bytes = [Text.Encoding]::UTF8.GetPreamble() + "
        "[Text.Encoding]::UTF8.GetBytes($env:GIT_UP_PLAN); "
        "[Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)"
    )
    valid_plans = [
        "- step: 1\n  subject: \"fix(parser): handle bom\"\n  files:\n    - parser.py\n",
        "- step: 1\n  subject: \"修复：解析计划\"\n  body: \"保留中文\"\n  files:\n    - 中文.txt\n",
        "- step: 1\n  subject: \"test: emoji ✅\"\n  files:\n    - emoji.txt\n",
    ]
    for yaml_text in valid_plans:
        result = run_shell_pipe(shell, producer_script, yaml_text)
        payload = parse_json(result)
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        assert_true(payload["ok"] is True, "PowerShell 管道中的合法计划应解析成功")

    invalid = "- step: 1\n  subject: \"缺少 files\"\n"
    result = run_shell_pipe(shell, producer_script, invalid)
    payload = parse_json(result)
    assert_true(result.returncode == 2, "非法计划应返回解析错误码 2")
    assert_true(payload["code"] == "missing_files", "非法计划应报告内容校验错误")


def test_git_bash_printf_pipe_preserves_plan_variants():
    """
    Given：Git Bash printf 管道输出 ASCII、中文和 emoji 计划。
    When：commit_plan.py parse 从该管道读取计划。
    Then：合法计划都能成功解析。
    防回归：确保 Git Bash 输入路径与 PowerShell 输入路径使用同一解析契约。
    """
    shell = git_bash_path()
    producer_script = 'printf "%s" "$GIT_UP_PLAN"'
    valid_plans = [
        "- step: 1\n  subject: \"feat: add parser test\"\n  files:\n    - test.py\n",
        "- step: 1\n  subject: \"中文计划\"\n  files:\n    - 中文.txt\n",
        "- step: 1\n  subject: \"emoji ✅\"\n  files:\n    - emoji.txt\n",
    ]
    for yaml_text in valid_plans:
        result = run_shell_pipe(shell, producer_script, yaml_text)
        payload = parse_json(result)
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        assert_true(payload["ok"] is True, "Git Bash printf 管道中的合法计划应解析成功")


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


def test_ignore_auto_detects_node_and_creates_documented_rules():
    """
    Given：一个尚未创建 .gitignore 的 Node.js 项目根目录。
    When：gitignore_manager.py 不指定技术栈直接执行自动维护。
    Then：创建带中文用途说明的 Node.js 与 OS 规则，且默认不加入 .env。
    防回归：防止自动模式漏掉依赖目录，或意外改变用户的环境文件跟踪策略。
    """
    with tempfile.TemporaryDirectory(prefix="git-up-ignore-node-") as tmp:
        repo = Path(tmp)
        (repo / "package.json").write_text('{"name":"demo"}\n', encoding="utf-8")
        result = run_ignore([], repo)
        payload = parse_json(result)
        content = (repo / ".gitignore").read_text(encoding="utf-8")
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        assert_true(payload["changed"] is True, "首次自动维护应创建规则")
        assert_true(payload["created"] is True, "首次写入不存在的 .gitignore 应报告创建")
        assert_true(payload["detected_stacks"] == ["node"], "应识别 package.json 对应的 Node.js 项目")
        assert_true("# Git-up：Node.js 依赖与包管理日志" in content, "规则应有中文分组说明")
        assert_true("node_modules/" in content, "应忽略可重建的 Node.js 依赖")
        assert_true(".env" not in content, "默认不得自动添加 .env 规则")


def test_ignore_selected_stack_does_not_expand_other_detected_stack():
    """
    Given：同时存在 Node.js 和 Python 清单的混合项目。
    When：用户显式指定 python 技术栈执行维护。
    Then：只写入 Python 规则，不自动扩展到 Node.js 规则。
    防回归：确保 `-i node python` 可作为精确控制入口而非提示性参数。
    """
    with tempfile.TemporaryDirectory(prefix="git-up-ignore-stack-") as tmp:
        repo = Path(tmp)
        (repo / "package.json").write_text('{"name":"demo"}\n', encoding="utf-8")
        (repo / "pyproject.toml").write_text("[project]\nname = 'demo'\n", encoding="utf-8")
        result = run_ignore(["python"], repo)
        content = (repo / ".gitignore").read_text(encoding="utf-8")
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        assert_true(".venv/" in content, "指定 python 时应写入 Python 虚拟环境规则")
        assert_true("node_modules/" not in content, "显式选择不得写入未选择的 Node.js 规则")


def test_ignore_custom_rule_is_documented_and_idempotent():
    """
    Given：已有用户手写规则的项目，用户提供一条自定义忽略规则和原因。
    When：以相同参数连续执行两次维护。
    Then：保留原有内容，仅第一次添加带原因的规则，第二次跳过等价规则。
    防回归：避免自动维护覆盖手写 .gitignore 或反复追加重复条目。
    """
    with tempfile.TemporaryDirectory(prefix="git-up-ignore-custom-") as tmp:
        repo = Path(tmp)
        (repo / ".gitignore").write_text("# 用户规则\nmanual-cache/\n", encoding="utf-8")
        first = run_ignore(["--add", "tmp/", "--reason", "本地调试输出"], repo)
        second = run_ignore(["--add", "tmp/", "--reason", "本地调试输出"], repo)
        first_payload = parse_json(first)
        second_payload = parse_json(second)
        content = (repo / ".gitignore").read_text(encoding="utf-8")
        assert_true(first.returncode == 0 and second.returncode == 0, "自定义规则维护应成功")
        assert_true("# 用户规则" in content and "manual-cache/" in content, "用户原有规则必须保留")
        assert_true("# Git-up：本地调试输出" in content, "自定义规则必须使用用户提供的说明")
        assert_true(content.count("tmp/") == 1, "同一自定义规则不得重复追加")
        assert_true(first_payload["changed"] is True, "首次添加应报告变更")
        assert_true(second_payload["changed"] is False and "tmp/" in second_payload["skipped_rules"], "再次执行应报告跳过")


def test_ignore_clean_previews_before_apply():
    """
    Given：Git-up 管理区块中存在一条与用户已有规则重复的模式。
    When：用户仅传入 --clean 而未传入 --apply。
    Then：JSON 列出待删除规则，但 .gitignore 内容保持完全不变。
    防回归：清理模式必须先可见地说明影响，不能因为显式 clean 就直接删除内容。
    """
    with tempfile.TemporaryDirectory(prefix="git-up-ignore-clean-") as tmp:
        repo = Path(tmp)
        ignore = repo / ".gitignore"
        original = "node_modules/\n\n# Git-up：Node.js 依赖与包管理日志（可通过包管理器重新生成）\nnode_modules/\n"
        ignore.write_text(original, encoding="utf-8")
        result = run_ignore(["--clean"], repo)
        payload = parse_json(result)
        assert_true(result.returncode == 0, result.stderr or result.stdout)
        assert_true(payload["mode"] == "clean_preview" and payload["changed"] is False, "默认 clean 应只预览")
        assert_true(payload["removals"][0]["rule"] == "node_modules/", "预览应说明重复规则")
        assert_true(ignore.read_text(encoding="utf-8") == original, "预览阶段不得改写 .gitignore")
        applied = run_ignore(["--clean", "--apply"], repo)
        applied_payload = parse_json(applied)
        assert_true(applied.returncode == 0 and applied_payload["changed"] is True, "明确 apply 后才应执行删除")
        assert_true(ignore.read_text(encoding="utf-8").count("node_modules/") == 1, "应用清理后应只保留一个规则")


def main() -> int:
    tests = [
        test_parse_full_plan,
        test_parse_optional_body_and_foot,
        test_missing_files_fails,
        test_plan_file_preserves_utf8_plan_variants,
        test_powershell_pipe_preserves_utf8_plan_variants,
        test_git_bash_printf_pipe_preserves_plan_variants,
        test_commit_plan_executes_only_planned_files,
        test_commit_refuses_pre_staged_changes,
        test_ignore_auto_detects_node_and_creates_documented_rules,
        test_ignore_selected_stack_does_not_expand_other_detected_stack,
        test_ignore_custom_rule_is_documented_and_idempotent,
        test_ignore_clean_previews_before_apply,
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
