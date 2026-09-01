#!/usr/bin/env python3
"""Aggregate read-only Git checks for the git-up -pc/-pcP fast path."""

from __future__ import annotations

import argparse
import json
import os
import stat
import subprocess
from pathlib import Path, PurePosixPath


CONFLICT_CODES = {"DD", "AU", "UD", "UA", "DU", "AA", "UU"}
BINARY_SUFFIXES = {
    ".7z",
    ".avi",
    ".bin",
    ".bmp",
    ".class",
    ".dll",
    ".doc",
    ".docx",
    ".exe",
    ".gif",
    ".gz",
    ".ico",
    ".jar",
    ".jpeg",
    ".jpg",
    ".mov",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".pyc",
    ".so",
    ".tar",
    ".webp",
    ".xls",
    ".xlsx",
    ".zip",
}
GENERATED_PARTS = {
    ".next",
    ".nuxt",
    "build",
    "coverage",
    "dist",
    "generated",
    "out",
    "target",
}
MAX_FAST_PATH_FILE_BYTES = 5 * 1024 * 1024


def run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def fail(command: list[str], result: subprocess.CompletedProcess[str]) -> dict[str, object]:
    return {
        "ok": False,
        "code": "git_failed",
        "command": ["git", *command],
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def parse_status(text: str) -> list[dict[str, str]]:
    changes: list[dict[str, str]] = []
    for raw_line in text.splitlines():
        if len(raw_line) < 4:
            continue
        status = raw_line[:2]
        path_text = raw_line[3:]
        if " -> " in path_text and ("R" in status or "C" in status):
            path_text = path_text.split(" -> ", 1)[1]
        changes.append({"status": status, "path": path_text.strip('"')})
    return changes


def top_level_module(path_text: str) -> str:
    parts = PurePosixPath(path_text.replace("\\", "/")).parts
    return parts[0] if len(parts) > 1 else "<root>"


def has_reparse_component(repo: Path, path_text: str) -> bool:
    current = repo
    for part in PurePosixPath(path_text.replace("\\", "/")).parts:
        current = current / part
        try:
            stats = current.lstat()
        except OSError:
            continue
        if current.is_symlink():
            return True
        attributes = getattr(stats, "st_file_attributes", 0)
        if attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
            return True
    return False


def has_nested_git_boundary(repo: Path, path_text: str) -> bool:
    candidate = repo / PurePosixPath(path_text.replace("\\", "/"))
    current = candidate if candidate.is_dir() else candidate.parent
    while current != repo and repo in current.parents:
        if (current / ".git").exists():
            return True
        current = current.parent
    return False


def operation_in_progress(repo: Path) -> bool:
    result = run_git(["rev-parse", "--git-dir"], repo)
    if result.returncode != 0:
        return False
    git_dir = Path(result.stdout.strip())
    if not git_dir.is_absolute():
        git_dir = repo / git_dir
    for marker in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"):
        marker_path = git_dir / marker
        if marker_path.exists():
            return True
    return False


def inspect(repo: Path, max_files: int) -> dict[str, object]:
    status_args = ["status", "--porcelain=v1", "-uall"]
    status_result = run_git(status_args, repo)
    if status_result.returncode != 0:
        return fail(status_args, status_result)

    changes = parse_status(status_result.stdout)
    paths = [item["path"] for item in changes]
    statuses = [item["status"] for item in changes]
    modules = sorted({top_level_module(path) for path in paths})
    staged_files = [item["path"] for item in changes if item["status"][0] not in {" ", "?"}]
    conflict_files = [item["path"] for item in changes if item["status"] in CONFLICT_CODES]

    reasons: list[str] = []
    if not changes:
        reasons.append("no_changes")
    if staged_files:
        reasons.append("staged_changes_present")
    if conflict_files:
        reasons.append("conflicts_present")
    if operation_in_progress(repo):
        reasons.append("git_operation_in_progress")
    if len(paths) > max_files:
        reasons.append("file_count_exceeded")
    if len(modules) > 1:
        reasons.append("multiple_modules")

    risky_files: list[str] = []
    for path_text in paths:
        path = repo / PurePosixPath(path_text.replace("\\", "/"))
        parts = {part.lower() for part in PurePosixPath(path_text.replace("\\", "/")).parts}
        is_large = path.is_file() and path.stat().st_size > MAX_FAST_PATH_FILE_BYTES
        if (
            path.suffix.lower() in BINARY_SUFFIXES
            or bool(parts & GENERATED_PARTS)
            or is_large
            or has_reparse_component(repo, path_text)
            or has_nested_git_boundary(repo, path_text)
        ):
            risky_files.append(path_text)
    if risky_files:
        reasons.append("risky_paths_present")

    return {
        "ok": True,
        "eligible": not reasons,
        "fast_path_used": False,
        "fallback_reasons": reasons,
        "semantic_review_required": True,
        "max_files": max_files,
        "file_count": len(paths),
        "modules": modules,
        "files": changes,
        "staged_files": staged_files,
        "conflict_files": conflict_files,
        "risky_files": risky_files,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect whether git-up may use the -pc/-pcP fast path.")
    parser.add_argument("--cwd", default=".", help="Git repository working directory")
    parser.add_argument("--max-files", type=int, default=5, help="Maximum changed files allowed")
    args = parser.parse_args()
    if args.max_files < 1:
        parser.error("--max-files must be at least 1")

    payload = inspect(Path(args.cwd).resolve(), args.max_files)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
