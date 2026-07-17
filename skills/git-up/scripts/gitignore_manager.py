#!/usr/bin/env python3
"""Detect project stacks and maintain a conservative .gitignore file."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RuleGroup:
    """A documented group of ignore patterns managed as one unit."""

    title: str
    rules: tuple[str, ...]


STACK_MARKERS: dict[str, tuple[str, ...]] = {
    "node": ("package.json",),
    "python": ("pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile", "poetry.lock", "uv.lock"),
}

STACK_GROUPS: dict[str, RuleGroup] = {
    "node": RuleGroup(
        "Git-up：Node.js 依赖与包管理日志（可通过包管理器重新生成）",
        ("node_modules/", "npm-debug.log*", "yarn-debug.log*", "yarn-error.log*", "pnpm-debug.log*"),
    ),
    "python": RuleGroup(
        "Git-up：Python 虚拟环境与解释器缓存（可重新生成）",
        (".venv/", "venv/", "__pycache__/", "*.py[cod]"),
    ),
}

OS_GROUP = RuleGroup("Git-up：操作系统生成的元数据文件（与源码无关）", (".DS_Store", "Thumbs.db"))
IDE_MARKERS: dict[str, str] = {
    ".idea": ".idea/",
    ".history": ".history/",
}


def detect_stacks(cwd: Path) -> list[str]:
    """Return the supported stacks whose root-level manifests exist."""
    return [stack for stack, markers in STACK_MARKERS.items() if any((cwd / marker).is_file() for marker in markers)]


def read_ignore(path: Path) -> tuple[list[str], str]:
    """Read lines without their terminators and retain the file's newline convention."""
    if not path.exists():
        return [], "\n"
    content = path.read_text(encoding="utf-8")
    newline = "\r\n" if "\r\n" in content else "\n"
    return content.splitlines(), newline


def existing_rules(lines: list[str]) -> set[str]:
    """Return normalized non-comment ignore patterns already present in the file."""
    return {line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")}


def auto_groups(cwd: Path, stacks: list[str]) -> list[RuleGroup]:
    """Build the conservative automatic rule set for this repository."""
    groups = [OS_GROUP]
    groups.extend(STACK_GROUPS[stack] for stack in stacks)
    ide_rules = tuple(rule for directory, rule in IDE_MARKERS.items() if (cwd / directory).is_dir())
    if ide_rules:
        groups.append(RuleGroup("Git-up：IDE 本地工作区配置（由编辑器生成）", ide_rules))
    return groups


def append_groups(lines: list[str], groups: list[RuleGroup]) -> tuple[list[str], list[dict[str, object]], list[str]]:
    """Append only missing patterns, retaining user-authored content byte-for-byte when unchanged."""
    known_rules = existing_rules(lines)
    result = list(lines)
    added_groups: list[dict[str, object]] = []
    skipped: list[str] = []

    for group in groups:
        missing = [rule for rule in group.rules if rule not in known_rules]
        skipped.extend(rule for rule in group.rules if rule in known_rules)
        if not missing:
            continue
        if result and result[-1].strip():
            result.append("")
        result.append(f"# {group.title}")
        result.extend(missing)
        known_rules.update(missing)
        added_groups.append({"title": group.title, "rules": missing})
    return result, added_groups, skipped


def validate_custom_rules(rules: list[str], reason: str | None) -> RuleGroup | None:
    """Validate custom patterns so the generated .gitignore stays line-oriented and readable."""
    if not rules:
        if reason:
            raise ValueError("--reason 必须与 --add 一起使用")
        return None
    if not reason or not reason.strip():
        raise ValueError("使用 --add 时必须同时提供 --reason 中文说明")
    normalized: list[str] = []
    for rule in rules:
        candidate = rule.strip()
        if not candidate or "\n" in rule or candidate.startswith("#"):
            raise ValueError("--add 规则必须是非空、单行且不能以 # 开头")
        normalized.append(candidate)
    return RuleGroup(f"Git-up：{reason.strip()}", tuple(normalized))


def git_up_block_lines(lines: list[str]) -> set[int]:
    """Return indexes for rules directly owned by a Git-up comment block."""
    owned: set[int] = set()
    in_block = False
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("# Git-up："):
            in_block = True
            continue
        if stripped.startswith("#") and stripped:
            in_block = False
            continue
        if in_block and stripped:
            owned.add(index)
    return owned


def clean_duplicate_rules(lines: list[str]) -> tuple[list[str], list[dict[str, object]]]:
    """Remove only duplicate patterns inside Git-up-owned blocks; never delete manual rules."""
    owned = git_up_block_lines(lines)
    seen: set[str] = set()
    remove_indexes: set[int] = set()
    removals: list[dict[str, object]] = []
    for index, line in enumerate(lines):
        pattern = line.strip()
        if not pattern or pattern.startswith("#"):
            continue
        if pattern in seen and index in owned:
            remove_indexes.add(index)
            removals.append({"line": index + 1, "rule": pattern, "reason": "Git-up 管理区块中的等价规则重复"})
        else:
            seen.add(pattern)
    return [line for index, line in enumerate(lines) if index not in remove_indexes], removals


def write_ignore(path: Path, lines: list[str], newline: str) -> None:
    """Write a normalized trailing newline only after a requested change."""
    path.write_text(newline.join(lines).rstrip() + newline, encoding="utf-8", newline="")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Detect and safely maintain a project .gitignore file.")
    parser.add_argument("stacks", nargs="*", choices=sorted(STACK_GROUPS), help="只维护指定技术栈；省略时自动识别")
    parser.add_argument("--cwd", default=".", help="目标 Git 项目目录")
    parser.add_argument("--add", action="append", default=[], help="追加一条自定义忽略规则，可重复传入")
    parser.add_argument("--reason", help="自定义规则的中文说明")
    parser.add_argument("--clean", action="store_true", help="仅检查 Git-up 管理区块中的重复规则")
    parser.add_argument("--apply", action="store_true", help="将 --clean 的预览结果真正写入文件")
    parser.add_argument("--dry-run", action="store_true", help="仅输出将要执行的变更，不写文件")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cwd = Path(args.cwd).resolve()
    ignore_path = cwd / ".gitignore"
    existed_before = ignore_path.exists()

    try:
        custom_group = validate_custom_rules(args.add, args.reason)
    except ValueError as exc:
        print(json.dumps({"ok": False, "code": "invalid_custom_rule", "message": str(exc)}, ensure_ascii=False, indent=2))
        return 2

    if args.clean and (args.stacks or custom_group):
        print(json.dumps({"ok": False, "code": "invalid_mode_combination", "message": "--clean 不能与技术栈或 --add 同时使用"}, ensure_ascii=False, indent=2))
        return 2
    if args.apply and not args.clean:
        print(json.dumps({"ok": False, "code": "invalid_mode_combination", "message": "--apply 仅用于确认 --clean 的清理写入"}, ensure_ascii=False, indent=2))
        return 2

    lines, newline = read_ignore(ignore_path)
    if args.clean:
        cleaned_lines, removals = clean_duplicate_rules(lines)
        changed = bool(removals) and args.apply and not args.dry_run
        if changed:
            write_ignore(ignore_path, cleaned_lines, newline)
        print(
            json.dumps(
                {
                    "ok": True,
                    "mode": "clean_apply" if args.apply else "clean_preview",
                    "path": str(ignore_path),
                    "changed": changed,
                    "removals": removals,
                    "next_step": None if args.apply else "确认后使用 --clean --apply 执行清理",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    detected = detect_stacks(cwd)
    selected = args.stacks or detected
    groups = auto_groups(cwd, selected)
    if custom_group:
        groups.append(custom_group)
    updated_lines, added_groups, skipped = append_groups(lines, groups)
    changed = bool(added_groups) and not args.dry_run
    if changed:
        write_ignore(ignore_path, updated_lines, newline)

    print(
        json.dumps(
            {
                "ok": True,
                "mode": "apply" if not args.dry_run else "preview",
                "path": str(ignore_path),
                "created": changed and not existed_before,
                "changed": changed,
                "detected_stacks": detected,
                "selected_stacks": selected,
                "added_groups": added_groups,
                "skipped_rules": skipped,
                "env_handling": "未自动添加 .env；只有用户通过 --add 显式指定时才会写入。",
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
