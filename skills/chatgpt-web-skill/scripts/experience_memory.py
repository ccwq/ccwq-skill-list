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
ENTRY_PATTERN = re.compile(r"^## (\d{4}-\d{2}-\d{2}) — (.+)$", re.MULTILINE)


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


def parse_entries(content: str, version: str) -> list[dict[str, str]]:
    """解析受本脚本维护的经验条目；未知形态拒绝覆写以保护用户数据。"""
    validate_content(content, version)
    matches = list(ENTRY_PATTERN.finditer(content))
    entries: list[dict[str, str]] = []
    field_pattern = re.compile(
        r"^- 场景: (?P<scene>[^\n]+)\n"
        r"- 结论: (?P<conclusion>[^\n]+)\n"
        r"- 边界: (?P<boundary>[^\n]+)\n?"
        r"(?:- 最近核验: (?P<last_verified>\d{4}-\d{2}-\d{2})\n?)?$"
    )
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
        body = content[match.end():end].strip()
        fields = field_pattern.fullmatch(body)
        if not fields:
            raise ValueError(f"第 {index + 1} 条经验格式无法安全整理，请保留原文件并人工核对")
        entry = {
            "first_recorded": match.group(1),
            "topic": compact(match.group(2)),
            "scene": compact(fields.group("scene")),
            "conclusion": compact(fields.group("conclusion")),
            "boundary": compact(fields.group("boundary")),
        }
        if fields.group("last_verified"):
            entry["last_verified"] = fields.group("last_verified")
        entries.append(entry)
    return entries


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


def render_entries(version: str, entries: list[dict[str, str]]) -> str:
    rendered = expected_header(version)
    for entry in entries:
        rendered += (
            f"\n## {entry['first_recorded']} — {entry['topic']}\n"
            f"- 场景: {entry['scene']}\n"
            f"- 结论: {entry['conclusion']}\n"
            f"- 边界: {entry['boundary']}\n"
        )
        if entry.get("last_verified"):
            rendered += f"- 最近核验: {entry['last_verified']}\n"
    return rendered


def trim_entries(
    path: Path,
    version: str,
    actions: list[dict[str, object]],
    verified_on: date | None = None,
) -> dict[str, object]:
    """按已确认的计划原子整理经验；每条原始经验必须被恰好处理一次。"""
    if not path.exists():
        raise ValueError("当前版本经验库不存在，无法整理空经验库")
    original = parse_entries(path.read_text(encoding="utf-8"), version)
    if not actions:
        raise ValueError("整理计划不能为空")

    consumed: set[int] = set()
    updated: list[dict[str, str]] = []
    counts = {"kept": 0, "rewritten": 0, "merged": 0, "removed": 0, "unverified": 0}
    verification_date = (verified_on or date.today()).isoformat()
    for action_number, action in enumerate(actions, start=1):
        operation = action.get("operation")
        indexes = action.get("source_indexes")
        verified = action.get("verified", False)
        if operation not in {"keep", "rewrite", "merge", "remove"}:
            raise ValueError(f"第 {action_number} 项操作无效")
        if not isinstance(indexes, list) or not indexes or any(type(value) is not int for value in indexes):
            raise ValueError(f"第 {action_number} 项必须提供非空整数 source_indexes")
        if type(verified) is not bool:
            raise ValueError(f"第 {action_number} 项 verified 必须是布尔值")
        if len(set(indexes)) != len(indexes) or any(value < 1 or value > len(original) for value in indexes):
            raise ValueError(f"第 {action_number} 项 source_indexes 越界或重复")
        if consumed.intersection(indexes):
            raise ValueError(f"第 {action_number} 项重复处理了原始经验")
        consumed.update(indexes)
        selected = [original[value - 1] for value in indexes]

        if operation == "keep":
            if len(selected) != 1:
                raise ValueError("保留操作只能对应一条原始经验")
            entry = dict(selected[0])
            counts["kept"] += 1
        elif operation == "remove":
            if verified is not True:
                raise ValueError("删除操作必须标记 verified=true，以证明有更强当前证据")
            counts["removed"] += len(selected)
            continue
        else:
            if operation == "rewrite" and len(selected) != 1:
                raise ValueError("改写操作只能对应一条原始经验")
            if operation == "merge" and len(selected) < 2:
                raise ValueError("合并操作至少对应两条原始经验")
            if verified is not True:
                raise ValueError(f"{operation} 操作必须标记 verified=true")
            try:
                values = {field: action[field] for field in ("topic", "scene", "conclusion", "boundary")}
                if any(not isinstance(value, str) for value in values.values()):
                    raise ValueError(f"{operation} 操作的内容字段必须是字符串")
                entry = {
                    "first_recorded": min(item["first_recorded"] for item in selected),
                    "topic": compact(values["topic"]),
                    "scene": compact(values["scene"]),
                    "conclusion": compact(values["conclusion"]),
                    "boundary": compact(values["boundary"]),
                }
            except KeyError as error:
                raise ValueError(f"{operation} 操作缺少字段：{error.args[0]}") from error
            counts["rewritten" if operation == "rewrite" else "merged"] += 1

        if verified is True:
            entry["last_verified"] = verification_date
        else:
            counts["unverified"] += 1
        updated.append(entry)

    expected_indexes = set(range(1, len(original) + 1))
    if consumed != expected_indexes:
        missing = sorted(expected_indexes - consumed)
        raise ValueError(f"整理计划遗漏原始经验：{missing}")

    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(render_entries(version, updated), encoding="utf-8")
    temporary.replace(path)
    count = len(updated)
    return {"path": str(path), "entries": count, **counts, "review_required": count >= 20}


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
    trim_parser = subparsers.add_parser("trim", help="按已确认的 JSON 计划原子整理当前版本经验库。")
    trim_parser.add_argument("--plan", required=True, type=Path, help="含 actions 数组的 JSON 文件")
    trim_parser.add_argument("--verified-on", type=date.fromisoformat, help="主动验证完成日期（YYYY-MM-DD）")
    trim_parser.add_argument("--confirm", action="store_true", help="确认计划已完成用户讨论并允许写回")
    args = parser.parse_args()

    try:
        version = load_skill_version()
        path = memory_path(version)
        if args.command == "status":
            result = status(path, version)
        elif args.command == "append":
            result = append_entry(path, version, args.topic, args.scene, args.conclusion, args.boundary)
        else:
            if not args.confirm:
                raise ValueError("trim 需要 --confirm；请在与用户完成讨论并获得 ok 后再写回")
            plan = json.loads(args.plan.read_text(encoding="utf-8"))
            if not isinstance(plan, dict) or not isinstance(plan.get("actions"), list):
                raise ValueError("整理计划必须是包含 actions 数组的 JSON 对象")
            result = trim_entries(path, version, plan["actions"], args.verified_on)
    except (OSError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 2

    print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
