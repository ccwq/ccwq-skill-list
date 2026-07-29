#!/usr/bin/env python3
"""校验项目级安装位置与记忆文件契约。"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


TEMPLATE_PATH = Path(__file__).parents[1] / "references" / "memory-template.md"
HEADER_LINES = tuple(
    line for line in TEMPLATE_PATH.read_text(encoding="utf-8").splitlines() if line
)

SENSITIVE_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\b(?:sk|rk|pk)_[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"(?i)\b(?:password|passwd|secret|token)\s*[:=]\s*[^\s<]{8,}"),
)


def resolve(path: Path) -> Path:
    return path.expanduser().resolve()


def validate(project_root: Path, skill_path: Path, require_memory: bool) -> list[str]:
    """返回全部契约违规项，使调用方一次获得可操作的报告。"""
    errors: list[str] = []
    expected_skill = project_root / ".agents" / "skills" / "project-self-memory"
    if skill_path != expected_skill:
        errors.append(
            "技能必须安装在 "
            f"{expected_skill}，当前路径为 {skill_path}。"
        )

    memory_path = project_root / "self-memory" / "memory.md"
    if not memory_path.exists():
        if require_memory:
            errors.append(f"缺少项目记忆文件：{memory_path}。")
        return errors

    text = memory_path.read_text(encoding="utf-8")
    for header_line in HEADER_LINES:
        if header_line not in text:
            errors.append(f"memory.md 缺少必需的来源/维护说明：{header_line}")

    for pattern in SENSITIVE_PATTERNS:
        if pattern.search(text):
            errors.append("memory.md 疑似包含敏感凭据，请改为可公开的结论表述。")
            break

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--skill-path", required=True, type=Path)
    parser.add_argument("--require-memory", action="store_true")
    args = parser.parse_args()

    errors = validate(
        resolve(args.project_root), resolve(args.skill_path), args.require_memory
    )
    if errors:
        print("PROJECT_SELF_MEMORY_INVALID")
        for error in errors:
            print(f"- {error}")
        return 1

    print("PROJECT_SELF_MEMORY_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
