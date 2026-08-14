#!/usr/bin/env python3
"""通过 agent-browser 执行可机械判定的 ChatGPT Web 运行时检查。"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Sequence

from run_agent_browser import (
    CdpConfigurationError,
    CdpConnectionError,
    build_command,
    cdp_setup_guidance,
    load_project_env,
    parse_cdp,
    resolve_cdp,
    session_for_cdp,
    verify_cdp_connection,
)


def run_cli(session: str, cdp: str | None, args: Sequence[str], tab: str | None = None) -> str:
    if tab:
        tab_result = subprocess.run(
            build_command(session, cdp, ["tab", tab]),
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if tab_result.returncode != 0:
            detail = tab_result.stderr.strip() or tab_result.stdout.strip() or f"exit {tab_result.returncode}"
            raise RuntimeError(f"无法切换到目标 tab {tab}: {detail}")
    command_args = list(args)
    input_text: str | None = None
    if len(command_args) == 2 and command_args[0] == "eval":
        # 复杂 JavaScript 通过 stdin 传给 CLI，避免 Windows PowerShell 拆分引号或括号。
        input_text = command_args[1]
        command_args = ["--json", "eval", "--stdin"]

    result = subprocess.run(
        build_command(session, cdp, command_args),
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        input=input_text,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        raise RuntimeError(detail)
    return result.stdout.strip()


def evaluate_project(url: str, title: str, snapshot: str, project: str) -> dict[str, object]:
    evidence: list[str] = []
    normalized_url = url.rstrip("/ ")
    if normalized_url.endswith("/project") or "/project?" in normalized_url or "/project#" in normalized_url:
        evidence.append("project_url")
    if project.casefold() in title.casefold():
        evidence.append("project_title")
    if f"New chat in {project}".casefold() in snapshot.casefold():
        evidence.append("project_composer")
    return {"project": project, "evidence": evidence, "evidence_count": len(evidence), "url": url, "title": title}


def extract_json_array(output: str) -> list[object]:
    decoder = json.JSONDecoder()
    for index, character in enumerate(output):
        if character not in "[{\"":
            continue
        try:
            value, _ = decoder.raw_decode(output[index:])
        except json.JSONDecodeError:
            continue
        array = find_json_array(value)
        if array is not None:
            return array
    first_character = next((character for character in output if not character.isspace()), "")
    first_codepoint = f"U+{ord(first_character):04X}" if first_character else "empty"
    raise ValueError(f"agent-browser eval 输出中没有可解析的 JSON array（长度 {len(output)}，首字符 {first_codepoint}）")


def find_json_array(value: object) -> list[object] | None:
    """从 CLI 的 JSON、嵌套 data 或字符串化 JSON 中提取第一个 array。"""
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for nested_value in value.values():
            array = find_json_array(nested_value)
            if array is not None:
                return array
    if isinstance(value, str):
        try:
            nested_value = json.loads(value)
        except json.JSONDecodeError:
            return None
        return find_json_array(nested_value)
    return None


def composer_expression() -> str:
    """读取当前可见 contenteditable 文本，不依赖 ChatGPT 的临时 selector。"""
    return (
        "JSON.stringify(Array.from(document.querySelectorAll('[contenteditable=\"true\"]'))"
        ".filter(element=>Boolean(element.offsetWidth||element.offsetHeight||element.getClientRects().length))"
        ".map(element=>element.innerText||element.textContent||''))"
    )


def evaluate_message(url: str, snapshot: str, composer_text: str, marker: str) -> dict[str, object]:
    """以 marker、composer 和认证页面信号分类一次提交结果。"""
    combined = f"{url}\n{snapshot}".casefold()
    auth_markers = ("/login", "sign in", "log in", "登录")
    auth_interrupted = any(auth_marker in combined for auth_marker in auth_markers)
    composer_has_marker = marker in composer_text
    snapshot_has_marker = marker in snapshot
    if auth_interrupted:
        status = "interrupted"
    elif snapshot_has_marker and not composer_has_marker:
        status = "sent"
    else:
        status = "pending"
    return {
        "status": status,
        "marker_in_snapshot": snapshot_has_marker,
        "marker_in_composer": composer_has_marker,
        "auth_interrupted": auth_interrupted,
        "url": url,
    }


def image_expression(selector: str, min_width: int) -> str:
    selector_json = json.dumps(selector)
    return (
        "JSON.stringify(Array.from(document.querySelectorAll("
        + selector_json
        + ")).filter(img=>img.getClientRects().length&&img.naturalWidth>="
        + str(min_width)
        + ").map(img=>({alt:img.alt,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,src:img.currentSrc||img.src})))"
    )


def has_visual_image_evidence(snapshot: str, marker: str) -> bool:
    """确认快照已呈现生成图标记；一旦成立就不再等待尺寸轮询。"""
    return bool(marker) and marker.casefold() in snapshot.casefold()


def check_project(session: str, cdp: str | None, tab: str | None, project: str, minimum: int) -> int:
    result = evaluate_project(
        run_cli(session, cdp, ["get", "url"], tab),
        run_cli(session, cdp, ["get", "title"], tab),
        run_cli(session, cdp, ["snapshot", "-i"], tab),
        project,
    )
    passed = int(result["evidence_count"]) >= minimum
    print(json.dumps({"ok": passed, "required_evidence": minimum, **result}, ensure_ascii=False))
    return 0 if passed else 1


def check_images(
    session: str,
    cdp: str | None,
    tab: str | None,
    selector: str,
    min_width: int,
    timeout: float,
    interval: float,
    screenshot: str | None,
    visual_marker: str,
) -> int:
    deadline = time.monotonic() + timeout
    expression = image_expression(selector, min_width)
    candidates: list[object] = []
    visual_evidence = False
    while True:
        snapshot = run_cli(session, cdp, ["snapshot", "-i"], tab)
        visual_evidence = has_visual_image_evidence(snapshot, visual_marker)
        if visual_evidence:
            break
        candidates = extract_json_array(run_cli(session, cdp, ["eval", expression], tab))
        if candidates or time.monotonic() >= deadline:
            break
        time.sleep(interval)

    if (visual_evidence or candidates) and screenshot:
        Path(screenshot).parent.mkdir(parents=True, exist_ok=True)
        run_cli(session, cdp, ["screenshot", screenshot], tab)
    source = "snapshot" if visual_evidence else "dimensions" if candidates else "none"
    print(
        json.dumps(
            {
                "ok": bool(visual_evidence or candidates),
                "images": candidates,
                "visual_evidence": visual_evidence,
                "evidence_source": source,
                "screenshot": screenshot,
            },
            ensure_ascii=False,
        )
    )
    return 0 if visual_evidence or candidates else 1


def check_message(
    session: str,
    cdp: str | None,
    tab: str | None,
    marker: str,
    timeout: float,
    interval: float,
) -> int:
    deadline = time.monotonic() + timeout
    result: dict[str, object] = {}
    while True:
        composer_values = extract_json_array(run_cli(session, cdp, ["eval", composer_expression()], tab))
        composer_text = "\n".join(value for value in composer_values if isinstance(value, str))
        result = evaluate_message(
            run_cli(session, cdp, ["get", "url"], tab),
            run_cli(session, cdp, ["snapshot", "-i"], tab),
            composer_text,
            marker,
        )
        if result["status"] != "pending" or time.monotonic() >= deadline:
            break
        time.sleep(interval)

    print(json.dumps({"ok": result["status"] == "sent", **result}, ensure_ascii=False))
    if result["status"] == "sent":
        return 0
    return 2 if result["status"] == "interrupted" else 1


def main() -> int:
    load_project_env()
    parser = argparse.ArgumentParser(description="执行 ChatGPT Web 的确定性运行时检查。")
    parser.add_argument("--session", default=session_for_cdp())
    parser.add_argument("--cdp", "-c", type=parse_cdp, help="CDP 端口或 http(s) URL。")
    parser.add_argument("--tab", help="每个读取前强制选中的稳定 agent-browser tab ID。")
    subparsers = parser.add_subparsers(dest="command", required=True)

    project_parser = subparsers.add_parser("project", help="检查 Project 归属的实时证据。")
    project_parser.add_argument("--name", default="agents-op")
    project_parser.add_argument("--minimum", type=int, default=2)

    image_parser = subparsers.add_parser("images", help="轮询达到尺寸阈值的可见生成图。")
    image_parser.add_argument("--selector", default='img[alt^="Generated image"]')
    image_parser.add_argument("--min-width", type=int, default=1000)
    image_parser.add_argument("--timeout", type=float, default=180)
    image_parser.add_argument("--interval", type=float, default=5)
    image_parser.add_argument("--screenshot")
    image_parser.add_argument("--visual-marker", default="Generated image")

    message_parser = subparsers.add_parser("message", help="轮询 marker 是否已离开 composer 并渲染。")
    message_parser.add_argument("--marker", required=True)
    message_parser.add_argument("--timeout", type=float, default=20)
    message_parser.add_argument("--interval", type=float, default=2)
    args = parser.parse_args()
    try:
        args.cdp = resolve_cdp(args.cdp)
        verify_cdp_connection(args.session, args.cdp)
    except (CdpConfigurationError, CdpConnectionError, argparse.ArgumentTypeError) as error:
        print(json.dumps({"ok": False, "error": f"{error}\n{cdp_setup_guidance()}"}, ensure_ascii=False))
        return 2

    try:
        if args.command == "project":
            return check_project(args.session, args.cdp, args.tab, args.name, args.minimum)
        if args.command == "images":
            return check_images(
                args.session,
                args.cdp,
                args.tab,
                args.selector,
                args.min_width,
                args.timeout,
                args.interval,
                args.screenshot,
                args.visual_marker,
            )
        return check_message(args.session, args.cdp, args.tab, args.marker, args.timeout, args.interval)
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
