#!/usr/bin/env python3
"""校验并维护 chatgpt-web-skill 的版本隔离经验库。"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path


SKILL_NAME = "chatgpt-web-skill"
ENTRY_PATTERN = re.compile(r"^## \d{4}-\d{2}-\d{2} — ", re.MULTILINE)


def skill_file() -> Path:
    return Path(__file__).resolve().parents[1] / "SKILL.md"


def load_skill_version(path: Path | None = None) -> str:
    content = (path or skill_file()).read_text(encoding="utf-8")
    match = re.search(r"(?m)^\s{2}version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$", content)
    if not match:
        raise ValueError("无法从 SKILL.md 读取 metadata.version")
    return match.group(1)


def memory_path(version: str, temp_root: Path | None = None) -> Path:
    root = temp_root or Path(os.environ.get("TEMP") or os.environ.get("TMPDIR") or "/tmp")
    return root / "chatgpt-web-skill-exp" / f"chatgpt-web-{version}.md"


def expected_header(version: str) -> str:
    return (
        f"# {SKILL_NAME} 经验库\n"
        f"Skill: {SKILL_NAME}\n"
        f"Skill-Version: {version}\n"
    )


def validate_content(content: str, version: str) -> None:
    if not content.startswith(expected_header(version)):
        raise ValueError("经验文件头缺失或与当前 Skill/version 不匹配")


def entry_count(content: str) -> int:
    return len(ENTRY_PATTERN.findall(content))


def compact(value: str) -> str:
    normalized = " ".join(value.split())
    if not normalized:
        raise ValueError("经验字段不能为空")
    return normalized


def append_entry(
    path: Path,
    version: str,
    topic: str,
    scene: str,
    conclusion: str,
    boundary: str,
    entry_date: date | None = None,
) -> dict[str, object]:
    if path.exists():
        content = path.read_text(encoding="utf-8")
        validate_content(content, version)
    else:
        content = expected_header(version)

    topic = compact(topic)
    scene = compact(scene)
    conclusion = compact(conclusion)
    boundary = compact(boundary)
    current_date = entry_date or date.today()
    entry = (
        f"\n## {current_date.isoformat()} — {topic}\n"
        f"- 场景: {scene}\n"
        f"- 结论: {conclusion}\n"
        f"- 边界: {boundary}\n"
    )

    if entry in content:
        count = entry_count(content)
        return {"path": str(path), "entries": count, "duplicate": True, "review_required": count >= 20}

    path.parent.mkdir(parents=True, exist_ok=True)
    updated = content.rstrip() + "\n" + entry
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(updated, encoding="utf-8")
    temporary.replace(path)
    count = entry_count(updated)
    return {"path": str(path), "entries": count, "duplicate": False, "review_required": count >= 20}


def status(path: Path, version: str) -> dict[str, object]:
    if not path.exists():
        return {"path": str(path), "exists": False, "valid": True, "entries": 0, "review_required": False}
    content = path.read_text(encoding="utf-8")
    validate_content(content, version)
    count = entry_count(content)
    return {"path": str(path), "exists": True, "valid": True, "entries": count, "review_required": count >= 20}


def main() -> int:
    parser = argparse.ArgumentParser(description="维护版本隔离、脱敏的 ChatGPT Web 经验库。")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("status", help="校验当前版本经验文件并输出条目计数。")
    append_parser = subparsers.add_parser("append", help="校验后原子追加一条已验证经验。")
    append_parser.add_argument("--topic", required=True)
    append_parser.add_argument("--scene", required=True)
    append_parser.add_argument("--conclusion", required=True)
    append_parser.add_argument("--boundary", required=True)
    args = parser.parse_args()

    try:
        version = load_skill_version()
        path = memory_path(version)
        if args.command == "status":
            result = status(path, version)
        else:
            result = append_entry(path, version, args.topic, args.scene, args.conclusion, args.boundary)
    except (OSError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 2

    print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
