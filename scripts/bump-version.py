#!/usr/bin/env python3
"""
bump-version.py -- Skill 版本管理脚本

用法:
  python scripts/bump-version.py <skill> --init [--date YYYY-MM-DD]
  python scripts/bump-version.py <skill> patch --changelog "..."
  python scripts/bump-version.py <skill> minor --changelog "..." --change-type added
  python scripts/bump-version.py <skill> --set 2.0.0 --changelog "..."
  python scripts/bump-version.py <skill> patch --changelog "..." --git
  python scripts/bump-version.py <skill> patch --dry-run
"""

import re
import sys
import argparse
import subprocess
from pathlib import Path
from datetime import date

SKILLS_DIR = Path(__file__).parent.parent / "skills"

CHANGE_TYPE_MAP = {
    "added":     ("新增",     "Added"),
    "changed":   ("更改",     "Changed"),
    "removed":   ("移除",     "Removed"),
    "fixed":     ("修复",     "Fixed"),
    "security":  ("安全",     "Security"),
    "deprecated":("废弃",     "Deprecated"),
}


def load_skill_meta(skill_dir: Path) -> dict:
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        raise FileNotFoundError(f"SKILL.md not found in {skill_dir}")
    text = skill_md.read_text(encoding="utf-8")
    fm_match = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    meta = {}
    if fm_match:
        for line in fm_match.group(1).splitlines():
            if ":" in line:
                key, _, val = line.partition(":")
                meta[key.strip()] = val.strip().strip('"').strip("'")
    return meta


def update_skill_version(skill_dir: Path, new_version: str) -> None:
    skill_md = skill_dir / "SKILL.md"
    text = skill_md.read_text(encoding="utf-8")
    fm_match = re.match(r"^(---)(\n.*?)(\n---)", text, re.DOTALL)
    if not fm_match:
        raise ValueError("SKILL.md has no valid frontmatter")

    frontmatter_block = fm_match.group(2)
    version_pattern = re.compile(r"^version:\s*.+?$", re.MULTILINE)

    if version_pattern.search(frontmatter_block):
        new_fm = version_pattern.sub(f"version: {new_version}", frontmatter_block)
    else:
        new_fm = frontmatter_block.rstrip() + f"\nversion: {new_version}\n"

    new_text = text[:fm_match.start(2)] + new_fm + text[fm_match.end(2):]
    skill_md.write_text(new_text, encoding="utf-8")
    print(f"  Updated SKILL.md -> version: {new_version}")


def bump_version(current: str, level: str) -> str:
    major, minor, patch = map(int, current.split("."))
    if level == "major":
        return f"{major + 1}.0.0"
    elif level == "minor":
        return f"{major}.{minor + 1}.0"
    elif level == "patch":
        return f"{major}.{minor}.{patch + 1}"
    else:
        raise ValueError(f"Invalid bump level: {level}")


def prepend_changelog(skill_dir: Path, new_version: str, change_type: str,
                      change_message: str, change_date: str = None) -> None:
    changelog_path = skill_dir / "CHANGELOG.md"
    today = change_date or date.today().isoformat()
    zh_label, en_label = CHANGE_TYPE_MAP.get(change_type, (change_type, change_type))

    new_entry = f"## [{new_version}] - {today}\n\n### {en_label} / {zh_label}\n- {change_message}\n\n"

    if changelog_path.exists():
        old_content = changelog_path.read_text(encoding="utf-8")
        # 在标题行之后插入
        lines = old_content.splitlines()
        insert_idx = 1  # 跳过 "# Changelog"
        new_lines = lines[:insert_idx] + [new_entry] + lines[insert_idx:]
        new_content = "\n".join(new_lines)
    else:
        new_content = (
            f"# Changelog\n\n"
            f"All notable changes to this skill will be documented in this file.\n\n"
            f"{new_entry}"
        )

    changelog_path.write_text(new_content, encoding="utf-8")
    print(f"  Prepended to CHANGELOG.md -> [{new_version}] {change_message}")


def ensure_changelog(skill_dir: Path, init_version: str = "1.0.0",
                      init_date: str = None) -> None:
    changelog_path = skill_dir / "CHANGELOG.md"
    today = init_date or date.today().isoformat()

    if changelog_path.exists():
        print("  CHANGELOG.md already exists, skipping creation.")
        return

    content = (
        f"# Changelog\n\n"
        f"All notable changes to this skill will be documented in this file.\n\n"
        f"## [{init_version}] - {today}\n\n"
        f"### Added / 新增\n"
        f"- 初始版本\n"
    )
    changelog_path.write_text(content, encoding="utf-8")
    print(f"  Created CHANGELOG.md -> initial version {init_version}")


def git_commit_and_tag(skill_name: str, version: str, change_message: str) -> None:
    repo_root = SKILLS_DIR.parent
    rel_skill_path = f"skills/{skill_name}"

    subprocess.run(["git", "add", f"{rel_skill_path}/SKILL.md", f"{rel_skill_path}/CHANGELOG.md"],
                   cwd=repo_root, check=True)
    commit_msg = f"{skill_name}({version}): {change_message}"
    subprocess.run(["git", "commit", "-m", commit_msg], cwd=repo_root, check=True)
    print(f"  Git commit created: {commit_msg}")

    tag_name = f"{skill_name}/v{version}"
    result = subprocess.run(["git", "tag", tag_name], cwd=repo_root)
    if result.returncode == 0:
        print(f"  Git tag created: {tag_name}")
    else:
        print(f"  Warning: tag {tag_name} already exists, skipping.")


def main():
    parser = argparse.ArgumentParser(description="Skill 版本管理工具")
    parser.add_argument("skill", help="Skill 目录名")
    parser.add_argument("level", nargs="?", choices=["major", "minor", "patch"],
                        help="版本递增级别")
    parser.add_argument("--set", metavar="VERSION", help="直接设置版本号（如 1.2.0）")
    parser.add_argument("--changelog", "-m", metavar="MSG", default="",
                        help="CHANGELOG 条目内容")
    parser.add_argument("--date", metavar="YYYY-MM-DD", help="CHANGELOG 日期（默认今天）")
    parser.add_argument("--git", action="store_true", help="自动执行 git add + commit + tag")
    parser.add_argument("--init", action="store_true",
                        help="初始化缺失 version 的 skill（设置为 1.0.0）")
    parser.add_argument("--dry-run", action="store_true",
                        help="仅打印将要执行的操作，不实际修改文件")
    parser.add_argument("--change-type", default="changed",
                        choices=list(CHANGE_TYPE_MAP.keys()),
                        help="Keep a Changelog 标签类型（默认 changed）")

    args = parser.parse_args()
    skill_dir = SKILLS_DIR / args.skill

    if not skill_dir.exists():
        print(f"Error: skill '{args.skill}' not found at {skill_dir}")
        sys.exit(1)

    # --init 模式
    if args.init:
        meta = load_skill_meta(skill_dir)
        if meta.get("version"):
            print(f"Skill '{args.skill}' already has version {meta['version']}, nothing to init.")
            sys.exit(0)
        if args.dry_run:
            print(f"[DRY RUN] Would init '{args.skill}' to 1.0.0")
            sys.exit(0)
        update_skill_version(skill_dir, "1.0.0")
        ensure_changelog(skill_dir, "1.0.0", args.date)
        if args.git:
            git_commit_and_tag(args.skill, "1.0.0", "feat: initialize skill version 1.0.0")
        sys.exit(0)

    # --set 模式
    if args.set:
        if not re.match(r"^\d+\.\d+\.\d+$", args.set):
            print(f"Error: invalid version format '{args.set}', expected MAJOR.MINOR.PATCH")
            sys.exit(1)
        change_msg = args.changelog or f"Update version to {args.set}"
        if args.dry_run:
            print(f"[DRY RUN] Would set '{args.skill}' to {args.set}")
            print(f"[DRY RUN] Would add changelog: {change_msg}")
            sys.exit(0)
        update_skill_version(skill_dir, args.set)
        prepend_changelog(skill_dir, args.set, args.change_type, change_msg, args.date)
        if args.git:
            git_commit_and_tag(args.skill, args.set, change_msg)
        sys.exit(0)

    # bump 模式
    if not args.level:
        print("Error: specify bump level (major/minor/patch) or use --set")
        parser.print_help()
        sys.exit(1)

    meta = load_skill_meta(skill_dir)
    current = meta.get("version")
    if not current:
        print(f"Error: skill '{args.skill}' has no version field. Run with --init first.")
        sys.exit(1)

    new_version = bump_version(current, args.level)
    change_msg = args.changelog or f"{args.level.capitalize()} version bump"

    if args.dry_run:
        print(f"[DRY RUN] Would bump '{args.skill}' from {current} to {new_version}")
        print(f"[DRY RUN] Would add changelog: [{new_version}] {change_msg}")
        sys.exit(0)

    update_skill_version(skill_dir, new_version)
    prepend_changelog(skill_dir, new_version, args.change_type, change_msg, args.date)

    if args.git:
        git_commit_and_tag(args.skill, new_version, change_msg)

    print(f"Done: {args.skill} {current} -> {new_version}")


if __name__ == "__main__":
    main()