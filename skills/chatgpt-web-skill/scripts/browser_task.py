#!/usr/bin/env python3
"""管理 ChatGPT Web 浏览器任务的 tab lease 与动作证据。"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Sequence
from urllib.parse import urlsplit
from uuid import uuid4

from run_agent_browser import build_command, parse_port, session_for_cdp


Runner = Callable[[list[str]], Any]


def normalize_url(url: str) -> str:
    """只移除 URL 末尾斜杠，保留 query 与 fragment。"""
    return url[:-1] if url.endswith("/") else url


def _find_arrays(value: Any) -> list[list[Any]]:
    arrays: list[list[Any]] = []
    if isinstance(value, list):
        arrays.append(value)
        for item in value:
            arrays.extend(_find_arrays(item))
    elif isinstance(value, dict):
        for nested in value.values():
            arrays.extend(_find_arrays(nested))
    return arrays


def _parse_json_values(output: str) -> list[Any]:
    decoder = json.JSONDecoder()
    values: list[Any] = []
    for index, character in enumerate(output):
        if character not in "[{":
            continue
        try:
            value, _ = decoder.raw_decode(output[index:])
        except json.JSONDecodeError:
            continue
        values.append(value)
    return values


def _record_id(record: dict[str, Any]) -> str | None:
    # 当前 agent-browser JSON 输出使用 index；旧版可能使用其他稳定标识。
    for key in ("id", "tabId", "targetId", "target_id", "index"):
        value = record.get(key)
        if value is not None and value != "":
            return str(value)
    return None


def _record_url(record: dict[str, Any]) -> str:
    for key in ("url", "href"):
        value = record.get(key)
        if value:
            return str(value)
    return ""


def parse_tab_list(output: str) -> list[dict[str, Any]]:
    """解析 agent-browser tab list，允许诊断文本包在 JSON 前后。"""
    records: list[dict[str, Any]] = []
    for value in _parse_json_values(output):
        candidates = [value]
        candidates.extend(_find_arrays(value))
        for candidate in candidates:
            if not isinstance(candidate, list):
                continue
            for item in candidate:
                if isinstance(item, dict) and _record_id(item):
                    record = dict(item)
                    record["id"] = _record_id(item)
                    record["url"] = _record_url(item)
                    if record not in records:
                        records.append(record)
    return records


def _parse_tab_record(output: str) -> dict[str, Any]:
    records = parse_tab_list(output)
    if records:
        return records[0]
    for value in _parse_json_values(output):
        if isinstance(value, dict) and _record_id(value):
            record = dict(value)
            record["id"] = _record_id(value)
            record["url"] = _record_url(value)
            return record
    match = re.search(r"\b(t\d+)\b", output)
    if match:
        return {"id": match.group(1), "url": ""}
    raise ValueError(f"无法从 agent-browser 输出解析 tab ID: {output[:200]}")


def _result_output(result: Any) -> str:
    if isinstance(result, str):
        return result
    return str(getattr(result, "stdout", ""))


def _result_code(result: Any) -> int:
    if isinstance(result, str):
        return 0
    return int(getattr(result, "returncode", 0))


def _invoke(runner: Runner, args: list[str], *, read_only: bool = False) -> Any:
    attempts = 2 if read_only else 1
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            result = runner(args)
            if _result_code(result) == 0:
                return result
            last_error = RuntimeError(_result_output(result).strip() or f"exit {_result_code(result)}")
        except Exception as error:  # pragma: no cover - exercised through caller-facing error JSON
            last_error = error
        if attempt + 1 < attempts:
            time.sleep(0.05)
    raise RuntimeError(str(last_error)) from last_error


def _default_root() -> Path:
    root = os.environ.get("TEMP") or os.environ.get("TMPDIR") or "/tmp"
    return Path(root) / "agent-browser-captures" / "chatgpt-web-skill"


def _write_lease(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    lease_dir = root / uuid4().hex
    lease_dir.mkdir(parents=True, exist_ok=False)
    lease_path = lease_dir / "lease.json"
    payload = {
        **payload,
        "lease_root": str(root),
        "lease": str(lease_path),
        "artifacts": {
            "before_snapshot": str(lease_dir / "before.snapshot"),
            "after_snapshot": str(lease_dir / "after.snapshot"),
        },
    }
    lease_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def _read_lease(path: str | Path) -> dict[str, Any]:
    lease_path = Path(path).resolve()
    payload = json.loads(lease_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not payload.get("tab_id") or "session" not in payload:
        raise ValueError("lease 缺少 session 或 tab_id")
    payload["lease"] = str(lease_path)
    return payload


def acquire_task(
    session: str | None,
    cdp: str | None,
    url: str,
    force_new: bool,
    root: Path | None = None,
    runner: Runner | None = None,
) -> dict[str, Any]:
    root = root or _default_root()
    runner = runner or make_runner(session, cdp)
    normalized = normalize_url(url)
    tabs = parse_tab_list(_result_output(_invoke(runner, ["--json", "tab", "list"], read_only=True)))
    existing_ids = {str(tab.get("id")) for tab in tabs}
    selected = None if force_new else next(
        (tab for tab in tabs if normalize_url(str(tab.get("url", ""))) == normalized),
        None,
    )
    created = selected is None
    if selected is None:
        new_output = _result_output(_invoke(runner, ["tab", "new", url]))
        try:
            selected = _parse_tab_record(new_output)
        except ValueError:
            # 当前 CLI 的 tab new 可能只回显 URL；重新 list 才能取得稳定 tab ID。
            refreshed = parse_tab_list(_result_output(_invoke(runner, ["--json", "tab", "list"], read_only=True)))
            selected = next(
                (
                    tab
                    for tab in refreshed
                    if str(tab.get("id")) not in existing_ids
                    and normalize_url(str(tab.get("url", ""))) == normalized
                ),
                None,
            )
            if selected is None:
                raise ValueError(f"tab new 后无法从实时 tab list 找到 {normalized}")
    payload = {
        "session": session,
        "cdp": cdp,
        "url": url,
        "normalized_url": normalized,
        "tab_id": str(selected["id"]),
        "created": created,
        "status": "active",
    }
    return _write_lease(root, payload)


def _artifact_path(payload: dict[str, Any], name: str) -> Path:
    lease_path = Path(str(payload["lease"])).resolve()
    path = lease_path.parent / name
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def action_task(lease: str, action: Sequence[str], runner: Runner | None = None) -> dict[str, Any]:
    payload = _read_lease(lease)
    action_args: list[str] = []
    context_args = {"--session", "--session-name", "--cdp", "--tab"}
    skip_next = False
    for argument in action:
        if skip_next:
            skip_next = False
            continue
        if argument in context_args:
            skip_next = True
            continue
        if any(argument.startswith(f"{flag}=") for flag in context_args):
            continue
        action_args.append(argument)
    runner = runner or make_runner(payload.get("session"), payload.get("cdp"))
    tab_id = str(payload["tab_id"])
    before_path = _artifact_path(payload, "before.snapshot")
    after_path = _artifact_path(payload, "after.snapshot")
    _invoke(runner, ["tab", tab_id])
    before = _result_output(_invoke(runner, ["snapshot", "-i"], read_only=True))
    before_path.write_text(before, encoding="utf-8")
    _invoke(runner, ["tab", tab_id])
    action_result = runner(action_args)
    returncode = _result_code(action_result)
    after_snapshot: str | None = None
    verification_error: str | None = None
    try:
        _invoke(runner, ["tab", tab_id])
        after_snapshot = _result_output(_invoke(runner, ["snapshot", "-i"], read_only=True))
        after_path.write_text(after_snapshot, encoding="utf-8")
    except Exception as error:
        verification_error = str(error)
        payload["status"] = "uncertain"
        Path(str(payload["lease"])).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "ok": returncode == 0 and verification_error is None,
        "operation": "action",
        "lease": str(payload["lease"]),
        "tab_id": tab_id,
        "created": bool(payload.get("created")),
        "status": payload.get("status", "active"),
        "returncode": returncode,
        "before_snapshot": str(before_path),
        "after_snapshot": str(after_path) if after_snapshot is not None else None,
        "verification_error": verification_error,
    }


def release_task(lease: str, purge: bool, runner: Runner | None = None) -> dict[str, Any]:
    payload = _read_lease(lease)
    runner = runner or make_runner(payload.get("session"), payload.get("cdp"))
    result: dict[str, Any] = {
        "ok": True,
        "operation": "release",
        "lease": str(payload["lease"]),
        "tab_id": str(payload["tab_id"]),
        "created": bool(payload.get("created")),
        "closed": False,
    }
    if payload.get("created"):
        current_tabs = parse_tab_list(_result_output(_invoke(runner, ["--json", "tab", "list"], read_only=True)))
        current_tab = next((tab for tab in current_tabs if str(tab.get("id")) == str(payload["tab_id"])), None)
        if current_tab is None:
            raise RuntimeError(f"lease tab {payload['tab_id']} 不在当前 tab list 中")
        expected_origin = urlsplit(str(payload.get("url", ""))).netloc
        current_origin = urlsplit(str(current_tab.get("url", ""))).netloc
        if expected_origin and current_origin != expected_origin:
            raise RuntimeError(f"lease tab {payload['tab_id']} URL 已变化，拒绝关闭")
        _invoke(runner, ["tab", "close", str(payload["tab_id"])])
        remaining = parse_tab_list(_result_output(_invoke(runner, ["--json", "tab", "list"], read_only=True)))
        if any(str(tab.get("id")) == str(payload["tab_id"]) for tab in remaining):
            raise RuntimeError(f"tab {payload['tab_id']} 关闭后仍存在")
        result["closed"] = True
    if purge:
        lease_dir = Path(str(payload["lease"])).resolve().parent
        root = Path(str(payload.get("lease_root", ""))).resolve()
        if root not in lease_dir.parents:
            raise RuntimeError("拒绝清理 lease 根目录之外的路径")
        shutil.rmtree(lease_dir)
        result["purged"] = True
    return result


def status_task(lease: str, runner: Runner | None = None) -> dict[str, Any]:
    payload = _read_lease(lease)
    runner = runner or make_runner(payload.get("session"), payload.get("cdp"))
    tabs = parse_tab_list(_result_output(_invoke(runner, ["--json", "tab", "list"], read_only=True)))
    present = any(str(tab.get("id")) == str(payload["tab_id"]) for tab in tabs)
    lifecycle = str(payload.get("status", "active"))
    return {
        "ok": present,
        "operation": "status",
        "lease": str(payload["lease"]),
        "tab_id": payload["tab_id"],
        "created": bool(payload.get("created")),
        "status": lifecycle,
        "stale": not present,
        "uncertain": lifecycle == "uncertain",
        "present": present,
    }


def make_runner(session: str | None, cdp: str | None) -> Runner:
    def runner(args: list[str]) -> subprocess.CompletedProcess[str]:
        command = build_command(session, cdp, args)
        return subprocess.run(command, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")

    return runner


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="管理 agent-browser 任务 tab 的 lease 与动作证据。")
    parser.add_argument("--session", default=session_for_cdp())
    parser.add_argument("--cdp", type=parse_port, default=os.environ.get("AGENT_BROWSER_CDP_PORT"))
    subparsers = parser.add_subparsers(dest="operation", required=True)

    acquire_parser = subparsers.add_parser("acquire")
    acquire_parser.add_argument("url")
    acquire_parser.add_argument("--force-new", action="store_true")
    acquire_parser.add_argument("--root", type=Path)

    status_parser = subparsers.add_parser("status")
    status_parser.add_argument("lease")

    action_parser = subparsers.add_parser("action")
    action_parser.add_argument("lease")
    action_parser.add_argument("agent_browser_args", nargs=argparse.REMAINDER)

    release_parser = subparsers.add_parser("release")
    release_parser.add_argument("lease")
    release_parser.add_argument("--purge", action="store_true")

    args = parser.parse_args(argv)
    if not args.cdp:
        print(json.dumps({"ok": False, "operation": args.operation, "error": "未配置已登录浏览器 CDP，拒绝启动新的浏览器会话。"}, ensure_ascii=False))
        return 2
    try:
        if args.operation == "acquire":
            result = {"ok": True, "operation": "acquire", **acquire_task(args.session, args.cdp, args.url, args.force_new, args.root)}
        elif args.operation == "status":
            result = status_task(args.lease)
        elif args.operation == "action":
            action = list(args.agent_browser_args)
            if action and action[0] == "--":
                action = action[1:]
            if not action:
                raise ValueError("action 需要 -- 后的 agent-browser 命令")
            result = action_task(args.lease, action)
        else:
            result = release_task(args.lease, args.purge)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get("ok", False) else 1
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "operation": args.operation, "error": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
