#!/usr/bin/env python3
"""Execute a git-up YAML-lite commit plan.

The parser intentionally supports only the small YAML subset emitted by
git-up -p. It is not a general YAML parser.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


class PlanError(Exception):
    def __init__(self, code: str, message: str, line: int | None = None):
        self.code = code
        self.message = message
        self.line = line
        super().__init__(message)

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {"ok": False, "code": self.code, "message": self.message}
        if self.line is not None:
            payload["line"] = self.line
        return payload


@dataclass
class Step:
    step: int
    subject: str
    body: str = ""
    foot: str = ""
    files: list[str] = field(default_factory=list)

    def message(self) -> str:
        parts = [self.subject]
        if self.body:
            parts.extend(["", self.body])
        if self.foot:
            parts.extend(["", self.foot])
        return "\n".join(parts).rstrip() + "\n"


def strip_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def parse_scalar(value: str) -> str:
    value = value.strip()
    if value in {"", "''", '""'}:
        return ""
    return strip_quotes(value)


def split_key_value(text: str, line_no: int) -> tuple[str, str]:
    if ":" not in text:
        raise PlanError("syntax", "expected '<key>: <value>'", line_no)
    key, value = text.split(":", 1)
    key = key.strip()
    if not key:
        raise PlanError("syntax", "empty key is not supported", line_no)
    return key, value.strip()


def parse_plan(text: str) -> list[Step]:
    lines = text.splitlines()
    steps: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    current_line = 0
    i = 0

    while i < len(lines):
        raw = lines[i]
        line_no = i + 1
        if not raw.strip():
            i += 1
            continue

        if raw.startswith("- "):
            current = {}
            current_line = line_no
            steps.append(current)
            rest = raw[2:].strip()
            if rest:
                key, value = split_key_value(rest, line_no)
                current[key] = parse_scalar(value)
            i += 1
            continue

        if current is None:
            raise PlanError("syntax", "plan must be a top-level list", line_no)

        if not raw.startswith("  ") or raw.startswith("    "):
            raise PlanError("indent", "step fields must use two-space indentation", line_no)

        field_text = raw[2:]
        key, value = split_key_value(field_text, line_no)

        if value == "|":
            block: list[str] = []
            i += 1
            while i < len(lines):
                block_raw = lines[i]
                block_line_no = i + 1
                if not block_raw.strip():
                    block.append("")
                    i += 1
                    continue
                if block_raw.startswith("    "):
                    block.append(block_raw[4:])
                    i += 1
                    continue
                if block_raw.startswith("  ") or block_raw.startswith("- "):
                    break
                raise PlanError("indent", "block scalar lines must use four-space indentation", block_line_no)
            current[key] = "\n".join(block).rstrip()
            continue

        if key == "files" and value == "":
            files: list[str] = []
            i += 1
            while i < len(lines):
                item_raw = lines[i]
                item_line_no = i + 1
                if not item_raw.strip():
                    i += 1
                    continue
                if item_raw.startswith("    - "):
                    item = parse_scalar(item_raw[6:])
                    if not item:
                        raise PlanError("invalid_files", "files entries must not be empty", item_line_no)
                    files.append(item)
                    i += 1
                    continue
                if item_raw.startswith("  ") or item_raw.startswith("- "):
                    break
                raise PlanError("indent", "files entries must use four-space list indentation", item_line_no)
            current[key] = files
            continue

        current[key] = parse_scalar(value)
        i += 1

    if not steps:
        raise PlanError("empty_plan", "plan contains no steps")

    parsed: list[Step] = []
    for index, item in enumerate(steps, start=1):
        try:
            step_raw = item["step"]
            subject_raw = item["subject"]
        except KeyError as exc:
            raise PlanError("missing_field", f"step {index} is missing required field: {exc.args[0]}") from exc

        try:
            step_no = int(str(step_raw))
        except ValueError as exc:
            raise PlanError("invalid_step", f"step {index} has non-integer step value: {step_raw}") from exc

        subject = str(subject_raw).strip()
        if not subject:
            raise PlanError("missing_field", f"step {step_no} subject must not be empty")

        files_raw = item.get("files")
        if not isinstance(files_raw, list) or not files_raw:
            raise PlanError("missing_files", f"step {step_no} files is required and must not be empty")

        parsed.append(
            Step(
                step=step_no,
                subject=subject,
                body=str(item.get("body", "")).strip(),
                foot=str(item.get("foot", "")).strip(),
                files=[str(file) for file in files_raw],
            )
        )

    return parsed


def run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def fail_git(step: int | None, completed: list[int], command: list[str], result: subprocess.CompletedProcess[str]) -> dict[str, object]:
    return {
        "ok": False,
        "code": "git_failed",
        "step": step,
        "completed_steps": completed,
        "command": command,
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def ensure_clean_index(cwd: Path) -> dict[str, object] | None:
    result = run_git(["diff", "--cached", "--name-only"], cwd)
    if result.returncode != 0:
        return fail_git(None, [], ["git", "diff", "--cached", "--name-only"], result)
    staged = [line for line in result.stdout.splitlines() if line.strip()]
    if staged:
        return {
            "ok": False,
            "code": "staged_changes_present",
            "message": "current index already has staged changes; aborting to avoid committing unplanned content",
            "staged_files": staged,
        }
    return None


def has_staged_diff(cwd: Path) -> bool:
    result = run_git(["diff", "--cached", "--quiet"], cwd)
    return result.returncode == 1


def execute_plan(steps: list[Step], cwd: Path) -> dict[str, object]:
    preflight = ensure_clean_index(cwd)
    if preflight is not None:
        return preflight

    completed: list[int] = []
    skipped: list[int] = []

    for item in steps:
        add_result = run_git(["add", "--", *item.files], cwd)
        if add_result.returncode != 0:
            return fail_git(item.step, completed, ["git", "add", "--", *item.files], add_result)

        if not has_staged_diff(cwd):
            skipped.append(item.step)
            continue

        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", delete=False) as handle:
            handle.write(item.message())
            message_path = Path(handle.name)

        try:
            commit_result = run_git(["commit", "-F", str(message_path)], cwd)
        finally:
            message_path.unlink(missing_ok=True)

        if commit_result.returncode != 0:
            return fail_git(item.step, completed, ["git", "commit", "-F", "<tempfile>"], commit_result)
        completed.append(item.step)

    log_count = max(len(completed), 1)
    log_result = run_git(["log", "--oneline", f"-{log_count}"], cwd)
    if log_result.returncode != 0:
        return fail_git(None, completed, ["git", "log", "--oneline", f"-{log_count}"], log_result)

    return {
        "ok": True,
        "completed_steps": completed,
        "skipped_steps": skipped,
        "git_log": log_result.stdout.strip(),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Parse or execute a git-up YAML-lite commit plan.")
    parser.add_argument("mode", choices=["parse", "commit"], help="parse only, or execute commits")
    parser.add_argument("--cwd", default=".", help="git repository working directory")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cwd = Path(args.cwd).resolve()
    text = sys.stdin.read()

    try:
        steps = parse_plan(text)
    except PlanError as exc:
        print(json.dumps(exc.to_dict(), ensure_ascii=False, indent=2))
        return 2

    if args.mode == "parse":
        print(json.dumps({"ok": True, "steps": [item.__dict__ for item in steps]}, ensure_ascii=False, indent=2))
        return 0

    result = execute_plan(steps, cwd)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
