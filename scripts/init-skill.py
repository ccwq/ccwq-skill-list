#!/usr/bin/env python3
"""
init-skill.py -- 创建新 Skill 目录结构，自动包含 version 和 CHANGELOG

用法:
  python scripts/init-skill.py <skill-name> [--title "标题"] [--description "描述"]
"""

import sys
import argparse
from pathlib import Path
from datetime import date

SKILLS_DIR = Path(__file__).parent.parent / "skills"

TEMPLATE_SKILL = """---
name: {name}
version: 1.0.0
description: {description}
---

# {title}

## 概述

## 使用场景

## 输入

## 输出

## 示例
"""

TEMPLATE_CHANGELOG = """# Changelog

All notable changes to this skill will be documented in this file.

## [1.0.0] - {date}

### Added / 新增
- 初始版本
"""


def create_skill(name: str, title: str = None, description: str = "") -> None:
    skill_dir = SKILLS_DIR / name
    if skill_dir.exists():
        print(f"Error: skill '{name}' already exists at {skill_dir}")
        sys.exit(1)

    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        TEMPLATE_SKILL.format(name=name, title=title or name, description=description),
        encoding="utf-8"
    )
    (skill_dir / "CHANGELOG.md").write_text(
        TEMPLATE_CHANGELOG.format(date=date.today().isoformat()),
        encoding="utf-8"
    )
    print(f"Created skill '{name}' at {skill_dir}")
    print(f"  - SKILL.md  (version: 1.0.0)")
    print(f"  - CHANGELOG.md  (initial 1.0.0 entry)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="创建新 Skill 目录结构")
    parser.add_argument("name", help="Skill 名称（目录名）")
    parser.add_argument("--title", help="Skill 显示标题")
    parser.add_argument("--description", default="", help="简短描述")
    args = parser.parse_args()
    create_skill(args.name, args.title, args.description)