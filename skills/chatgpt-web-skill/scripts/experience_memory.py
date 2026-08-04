#!/usr/bin/env python3
"""独占维护 chatgpt-web-skill 的统一经验库。"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from datetime import date
from pathlib import Path
from typing import Any


SKILL_NAME = "chatgpt-web-skill"
PRESET_GROUPS = ("浏览器会话", "Project路由", "消息提交", "图片生成编辑", "图片交付", "视觉审查", "Research", "经验机制")
ENTRY_RE = re.compile(r"^- \[(\d{2}-\d{2}-\d{2})\] (.+)$")
HEADER_RE = re.compile(r"^# chatgpt-web-skill 经验库\nSkill-Version: (.+)\nEntry-Count: (\d+)\n$")


def skill_file() -> Path:
    return Path(__file__).resolve().parents[1] / "SKILL.md"


def load_skill_version(path: Path | None = None) -> str:
    content = (path or skill_file()).read_text(encoding="utf-8")
    match = re.search(r"(?m)^\s{2}version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$", content)
    if not match:
        raise ValueError("无法从 SKILL.md 读取 metadata.version")
    return match.group(1)


def memory_path(environ: dict[str, str] | None = None, platform: str | None = None) -> Path:
    environment = environ or os.environ
    current_platform = platform or sys.platform
    home = environment.get("USERPROFILE") if current_platform.startswith("win") else environment.get("HOME")
    if not home:
        raise ValueError("无法确定用户配置目录；请设置 USERPROFILE 或 HOME")
    return Path(home) / ".config" / SKILL_NAME / "experience.md"


def compact(value: object, field: str = "经验字段") -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} 必须是字符串")
    result = " ".join(value.split())
    if not result:
        raise ValueError(f"{field} 不能为空")
    return result


def today() -> date:
    fixed = os.environ.get("CHATGPT_WEB_SKILL_EXPERIENCE_TODAY")
    return date.fromisoformat(fixed) if fixed else date.today()


def warning(code: str, **context: object) -> dict[str, object]:
    return {"code": code, "context": context}


def new_library(version: str) -> dict[str, object]:
    return {"version": version, "header_count": 0, "groups": [{"name": name, "entries": []} for name in PRESET_GROUPS]}


def parse_library(content: str) -> dict[str, object]:
    normalized = content.replace("\r\n", "\n")
    lines = normalized.splitlines()
    if len(lines) < 3:
        raise ValueError("经验文件头不完整，已拒绝覆盖")
    header = "\n".join(lines[:3]) + "\n"
    match = HEADER_RE.fullmatch(header)
    if not match:
        raise ValueError("经验文件头格式无效，已拒绝覆盖")
    groups: list[dict[str, object]] = []
    index = 3
    while index < len(lines):
        if not lines[index]:
            index += 1
            continue
        if not lines[index].startswith("## "):
            raise ValueError("经验分组格式无效，已拒绝覆盖")
        name = compact(lines[index][3:], "分组")
        if any(group["name"] == name for group in groups):
            raise ValueError("经验分组重复，已拒绝覆盖")
        index += 1
        entries: list[dict[str, str]] = []
        while index < len(lines) and not lines[index].startswith("## "):
            if not lines[index]:
                index += 1
                continue
            entry_match = ENTRY_RE.fullmatch(lines[index])
            if not entry_match or index + 3 >= len(lines):
                raise ValueError("经验条目格式无效，已拒绝覆盖")
            values: dict[str, str] = {"date": entry_match.group(1), "topic": compact(entry_match.group(2), "主题")}
            for offset, label, key in ((1, "  场景: ", "scene"), (2, "  结论: ", "conclusion"), (3, "  边界: ", "boundary")):
                line = lines[index + offset]
                if not line.startswith(label):
                    raise ValueError("经验条目字段格式无效，已拒绝覆盖")
                values[key] = compact(line[len(label):], key)
            index += 4
            if index < len(lines) and lines[index].startswith("  最近核验: "):
                verified = lines[index][len("  最近核验: "):]
                try:
                    date.fromisoformat(verified)
                except ValueError as error:
                    raise ValueError("最近核验日格式无效，已拒绝覆盖") from error
                values["last_verified"] = verified
                index += 1
            entries.append(values)
        groups.append({"name": name, "entries": entries})
    return {"version": compact(match.group(1), "Skill-Version"), "header_count": int(match.group(2)), "groups": groups}


def count_entries(library: dict[str, object]) -> int:
    return sum(len(group["entries"]) for group in library["groups"])  # type: ignore[index,arg-type]


def render_library(library: dict[str, object], version: str) -> str:
    groups: list[dict[str, object]] = library["groups"]  # type: ignore[assignment]
    count = count_entries(library)
    lines = ["# chatgpt-web-skill 经验库", f"Skill-Version: {version}", f"Entry-Count: {count}", ""]
    for group in groups:
        lines.extend((f"## {group['name']}",))
        for entry in group["entries"]:  # type: ignore[index]
            lines.extend((
                f"- [{entry['date']}] {entry['topic']}",
                f"  场景: {entry['scene']}",
                f"  结论: {entry['conclusion']}",
                f"  边界: {entry['boundary']}",
            ))
            if entry.get("last_verified"):
                lines.append(f"  最近核验: {entry['last_verified']}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


class LibraryLock:
    def __init__(self, path: Path, timeout: float = 15.0) -> None:
        self.path = path.with_suffix(path.suffix + ".lock")
        self.timeout = timeout
        self.descriptor: int | None = None

    def __enter__(self) -> "LibraryLock":
        deadline = time.monotonic() + self.timeout
        self.path.parent.mkdir(parents=True, exist_ok=True)
        while True:
            try:
                self.descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(self.descriptor, str(os.getpid()).encode())
                return self
            except FileExistsError:
                if time.monotonic() >= deadline:
                    raise ValueError("经验库正被其他进程维护，请稍后重试")
                time.sleep(0.05)

    def __exit__(self, *_: object) -> None:
        if self.descriptor is not None:
            os.close(self.descriptor)
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def warnings_for(library: dict[str, object], current_version: str) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    actual = count_entries(library)
    if library["version"] != current_version:
        result.append(warning("version_mismatch", file_version=library["version"], current_version=current_version))
    if library["header_count"] != actual:
        result.append(warning("entry_count_mismatch", header_count=library["header_count"], actual_count=actual))
    if actual > 50:
        result.append(warning("experience_limit_exceeded", actual_count=actual, limit=50))
    return result


def project_entry(group: str, entry: dict[str, str], full: bool) -> dict[str, str]:
    result = {"date": entry["date"], "group": group, "conclusion": entry["conclusion"], "boundary": entry["boundary"]}
    if full:
        result.update({"topic": entry["topic"], "scene": entry["scene"]})
        if entry.get("last_verified"):
            result["last_verified"] = entry["last_verified"]
    return result


def read_library(path: Path, current_version: str, full: bool = False) -> dict[str, object]:
    if not path.exists():
        library = new_library(current_version)
        groups = [{"group": group["name"], "entries": []} for group in library["groups"]]  # type: ignore[index]
        return {"path": str(path), "exists": False, "current_version": current_version, "file_version": None, "actual_entry_count": 0, "header_entry_count": 0, "warnings": [], "entries": [], "groups": groups}
    library = parse_library(path.read_text(encoding="utf-8"))
    groups = [
        {"group": group["name"], "entries": [project_entry(group["name"], entry, full) for entry in group["entries"]]}  # type: ignore[index]
        for group in library["groups"]  # type: ignore[index]
    ]
    entries = [entry for group in groups for entry in group["entries"]]
    return {"path": str(path), "exists": True, "current_version": current_version, "file_version": library["version"], "actual_entry_count": count_entries(library), "header_entry_count": library["header_count"], "warnings": warnings_for(library, current_version), "entries": entries, "groups": groups}


def require_writable(library: dict[str, object], current_version: str) -> list[dict[str, object]]:
    warnings = warnings_for(library, current_version)
    if any(item["code"] == "entry_count_mismatch" for item in warnings):
        raise ValueError("entry_count_mismatch：请先通过 trim 修复经验库计数")
    return warnings


def append_entry(path: Path, current_version: str, group_name: str, topic: str, scene: str, conclusion: str, boundary: str, create_group: bool = False) -> dict[str, object]:
    with LibraryLock(path):
        library = parse_library(path.read_text(encoding="utf-8")) if path.exists() else new_library(current_version)
        prior_warnings = require_writable(library, current_version)
        group_name = compact(group_name, "分组")
        groups: list[dict[str, object]] = library["groups"]  # type: ignore[assignment]
        group = next((item for item in groups if item["name"] == group_name), None)
        if group is None:
            if not create_group:
                raise ValueError("新分组必须显式提供 --create-group")
            group = {"name": group_name, "entries": []}
            groups.append(group)
        entry = {"date": today().strftime("%y-%m-%d"), "topic": compact(topic, "主题"), "scene": compact(scene, "场景"), "conclusion": compact(conclusion, "结论"), "boundary": compact(boundary, "边界")}
        fingerprint = (group_name, entry["scene"], entry["conclusion"], entry["boundary"])
        duplicate = False
        for candidate_group in groups:
            for candidate in candidate_group["entries"]:  # type: ignore[index]
                candidate_key = (candidate_group["name"], candidate["scene"], candidate["conclusion"], candidate["boundary"])
                if candidate_key == fingerprint:
                    candidate["last_verified"] = today().isoformat()
                    duplicate = True
                    break
            if duplicate:
                break
        if not duplicate:
            group["entries"].append(entry)  # type: ignore[index]
        atomic_write(path, render_library(library, library["version"]))
        library["header_count"] = count_entries(library)
        return {"path": str(path), "duplicate": duplicate, "actual_entry_count": count_entries(library), "warnings": prior_warnings + [item for item in warnings_for(library, current_version) if item not in prior_warnings]}


def trim_library(path: Path, current_version: str, actions: list[dict[str, object]]) -> dict[str, object]:
    with LibraryLock(path):
        if not path.exists():
            raise ValueError("经验库不存在，无法整理")
        library = parse_library(path.read_text(encoding="utf-8"))
        flattened = [(group, entry) for group in library["groups"] for entry in group["entries"]]  # type: ignore[index]
        if not actions:
            raise ValueError("整理计划不能为空")
        consumed: set[int] = set()
        output: list[tuple[str, dict[str, str]]] = []
        counts = {"kept": 0, "rewritten": 0, "merged": 0, "removed": 0, "unverified": 0}
        for number, action in enumerate(actions, 1):
            operation = action.get("operation")
            indexes = action.get("source_indexes")
            if operation not in {"keep", "rewrite", "merge", "remove", "unverified"}:
                raise ValueError(f"第 {number} 项操作无效")
            if not isinstance(indexes, list) or not indexes or any(type(index) is not int for index in indexes):
                raise ValueError(f"第 {number} 项 source_indexes 必须是非空整数数组")
            if len(indexes) != len(set(indexes)) or any(index < 1 or index > len(flattened) for index in indexes) or consumed.intersection(indexes):
                raise ValueError(f"第 {number} 项 source_indexes 越界或重复")
            consumed.update(indexes)
            selected = [flattened[index - 1] for index in indexes]
            if operation in {"keep", "unverified", "rewrite"} and len(selected) != 1:
                raise ValueError(f"{operation} 只能处理一条原始经验")
            if operation == "merge" and len(selected) < 2:
                raise ValueError("merge 至少处理两条原始经验")
            if operation in {"rewrite", "merge", "remove"}:
                compact(action.get("evidence"), "evidence")
            if operation == "remove":
                counts["removed"] += len(selected)
                continue
            if operation in {"keep", "unverified"}:
                source_group, source_entry = selected[0]
                output.append((source_group["name"], dict(source_entry)))
                counts["kept" if operation == "keep" else "unverified"] += 1
                continue
            values = {field: compact(action.get(field), field) for field in ("topic", "scene", "conclusion", "boundary")}
            group_name = compact(action.get("group", selected[0][0]["name"]), "group")
            if not any(group["name"] == group_name for group in library["groups"]):  # type: ignore[index]
                raise ValueError("trim 不能隐式创建新分组")
            entry = {"date": min(item[1]["date"] for item in selected), **values, "last_verified": today().isoformat()}
            output.append((group_name, entry))
            counts["rewritten" if operation == "rewrite" else "merged"] += 1
        if consumed != set(range(1, len(flattened) + 1)):
            raise ValueError("整理计划必须恰好覆盖每条原始经验")
        rebuilt = new_library(current_version)
        for original_group in library["groups"]:  # type: ignore[index]
            if not any(group["name"] == original_group["name"] for group in rebuilt["groups"]):  # type: ignore[index]
                rebuilt["groups"].append({"name": original_group["name"], "entries": []})  # type: ignore[index]
        targets = {group["name"]: group for group in rebuilt["groups"]}  # type: ignore[index]
        for group_name, entry in output:
            targets[group_name]["entries"].append(entry)  # type: ignore[index]
        atomic_write(path, render_library(rebuilt, current_version))
        rebuilt["header_count"] = count_entries(rebuilt)
        return {"path": str(path), "actual_entry_count": count_entries(rebuilt), "warnings": warnings_for(rebuilt, current_version), **counts}


def main() -> int:
    parser = argparse.ArgumentParser(description="维护 chatgpt-web-skill 的统一经验库")
    subparsers = parser.add_subparsers(dest="command", required=True)
    read_parser = subparsers.add_parser("read", help="读取统一经验库")
    read_parser.add_argument("--full", action="store_true", help="返回主题、场景和最近核验日")
    subparsers.add_parser("status", help="兼容接口：只返回经验库元数据")
    append_parser = subparsers.add_parser("append", help="追加一条已验证经验")
    append_parser.add_argument("--group", required=True)
    append_parser.add_argument("--create-group", action="store_true")
    append_parser.add_argument("--topic", required=True)
    append_parser.add_argument("--scene", required=True)
    append_parser.add_argument("--conclusion", required=True)
    append_parser.add_argument("--boundary", required=True)
    trim_parser = subparsers.add_parser("trim", help="按已确认计划整理统一经验库")
    trim_parser.add_argument("--plan", required=True, type=Path)
    trim_parser.add_argument("--confirm", required=True, help="仅接受用户明确确认词 ok")
    args = parser.parse_args()
    try:
        version = load_skill_version()
        path = memory_path()
        if args.command == "read":
            result = read_library(path, version, args.full)
        elif args.command == "status":
            result = read_library(path, version, False)
            result.pop("entries")
            result.pop("groups")
        elif args.command == "append":
            result = append_entry(path, version, args.group, args.topic, args.scene, args.conclusion, args.boundary, args.create_group)
        else:
            if args.confirm != "ok":
                raise ValueError("trim 仅在用户明确回复 ok 后执行；请传入 --confirm ok")
            plan = json.loads(args.plan.read_text(encoding="utf-8"))
            if not isinstance(plan, dict) or not isinstance(plan.get("actions"), list):
                raise ValueError("整理计划必须是包含 actions 数组的 JSON 对象")
            result = trim_library(path, version, plan["actions"])
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
