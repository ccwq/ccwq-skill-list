#!/usr/bin/env python3
"""通过 agent-browser 执行可机械判定的 ChatGPT Web 运行时检查。"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
from urllib.parse import urlsplit
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


def trusted_chatgpt_url(url: str) -> bool:
    """只允许 HTTPS 官方站点；拒绝 userinfo、非标准端口和相似域名。"""
    try:
        parsed = urlsplit(url.strip())
        return (parsed.scheme == "https" and parsed.hostname in {"chatgpt.com", "chat.openai.com"}
                and parsed.port in {None, 443} and not parsed.username and not parsed.password)
    except ValueError:
        return False


def evaluate_project(url: str, title: str, snapshot: str, project: str, minimum: int = 2) -> dict[str, object]:
    evidence: list[str] = []
    conflicts: list[str] = []
    trusted = trusted_chatgpt_url(url)
    route = bool(re.fullmatch(r"/g/[^/]+/(?:project/?|c/[^/]+/?)", urlsplit(url).path)) if trusted else False
    if route:
        evidence.append("project_url")
    # URL 证明 Project 页面结构；标题/composer 若提供名称，必须按完整上下文精确匹配。
    title_name = None
    for pattern in (r"ChatGPT\s+-\s+(.+)", r"(.+?)\s+-\s+ChatGPT"):
        match = re.fullmatch(pattern, title.strip())
        if match:
            title_name = match.group(1).strip()
            break
    if title.strip() == project:
        title_name = project
    if title_name == project:
        evidence.append("project_title")
    elif title_name:
        conflicts.append("project_title")
    composer_names = []
    for line in snapshot.splitlines():
        match = re.search(r'\b(?:textbox|combobox)\s+"?New chat in (.+?)(?:"|\s+\[|$)', line.strip())
        if match:
            composer_names.append(match.group(1).strip())
    if project in composer_names:
        evidence.append("project_composer")
    if any(name != project for name in composer_names):
        conflicts.append("project_composer")
    ownership_count = sum(item in evidence for item in ("project_title", "project_composer"))
    required = max(2, minimum)
    passed = trusted and route and ownership_count >= 1 and len(evidence) >= required and not conflicts
    return {"project": project, "passed": passed, "evidence": evidence, "evidence_count": len(evidence),
            "ownership_evidence_count": ownership_count, "conflicts": conflicts, "trusted_site": trusted,
            "required_evidence": required, "url": url, "title": title}


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


def auth_interrupted(url: str, snapshot: str) -> bool:
    return bool(re.search(r"/(?:login|auth)(?:/|$|\?)", urlsplit(url).path)
                or re.search(r'(?im)\b(?:button|link)\s+"?(?:sign in|log in|登录)"?(?:\s+\[|$)', snapshot))


def evaluate_message(url: str, snapshot: str, composer_text: str, marker: str) -> dict[str, object]:
    """兼容旧调用；全页 marker 只是线索，绝不能证明本次完整提交。"""
    interrupted = auth_interrupted(url, snapshot)
    return {"status": "interrupted" if interrupted else "uncertain",
            "reason": "authentication" if interrupted else "legacy_marker_is_only_a_clue",
            "marker_in_snapshot": bool(marker) and marker in snapshot,
            "marker_in_composer": bool(marker) and marker in composer_text,
            "auth_interrupted": interrupted, "url": url}


def normalize_body(text: str) -> str:
    # 只统一平台换行，不 trim、不折叠空白，尾部也必须完全一致。
    return text.replace("\r\n", "\n").replace("\r", "\n")


def body_hash(text: str) -> str:
    return hashlib.sha256(normalize_body(text).encode("utf-8")).hexdigest()


def message_expression(user_selector: str, conversation_selector: str) -> str:
    """selector 必须由调用方现场发现；角色校验独立于调用方 selector。"""
    return r'''
    (() => {
      const roots = document.querySelectorAll(%s);
      const visible = el => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const composers = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'))
        .filter(visible).map(el => typeof el.value === 'string' ? el.value : el.innerText);
      const nodes = roots.length === 1 ? Array.from(roots[0].querySelectorAll(%s)) : [];
      const userRoles = roots.length === 1 ? Array.from(roots[0].querySelectorAll('[data-message-author-role="user"]')) : [];
      const coverage = nodes.length === userRoles.length && userRoles.every(role =>
        nodes.filter(el => el.closest('[data-message-author-role]') === role && el.innerText === role.innerText).length === 1);
      return JSON.stringify([{
        url: location.href, rootCount: roots.length, coverage, composers,
        messages: nodes.map(el => {
          const role = el.closest('[data-message-author-role]');
          const owner = el.closest('[data-message-id]');
          return {role: role ? role.getAttribute('data-message-author-role') : null,
                  id: owner ? owner.getAttribute('data-message-id') : null,
                  text: el.innerText, visible: visible(el),
                  complete: !el.querySelector('[aria-expanded="false"], [hidden]')};
        })
      }]);
    })()
    ''' % (json.dumps(conversation_selector), json.dumps(user_selector))


def read_message_observation(session: str, cdp: str | None, tab: str | None,
                             user_selector: str, conversation_selector: str) -> dict[str, object]:
    url = run_cli(session, cdp, ["get", "url"], tab)
    snapshot = run_cli(session, cdp, ["snapshot", "-i"], tab)
    if auth_interrupted(url, snapshot):
        return {"status": "interrupted", "reason": "authentication"}
    if not trusted_chatgpt_url(url):
        return {"status": "uncertain", "reason": "untrusted_site"}
    values = extract_json_array(run_cli(session, cdp, ["eval", message_expression(user_selector, conversation_selector)], tab))
    if len(values) != 1 or not isinstance(values[0], dict):
        raise ValueError("invalid observation")
    result = values[0]
    if result.get("url") != url:
        raise ValueError("page changed during read")
    messages, composers = result.get("messages"), result.get("composers")
    if (result.get("rootCount") != 1 or result.get("coverage") is not True or not isinstance(messages, list)
            or not isinstance(composers, list) or len(composers) != 1 or not isinstance(composers[0], str)):
        raise ValueError("missing or ambiguous DOM")
    if any(not isinstance(item, dict) or item.get("role") != "user" or not isinstance(item.get("text"), str)
           or item.get("visible") is not True or item.get("complete") is not True
           or (item.get("id") is not None and not isinstance(item.get("id"), str)) for item in messages):
        raise ValueError("unverified user message DOM")
    # 只向状态文件写摘要，永不持久化正文。
    result["messages"] = [{"id": item.get("id"), "hash": body_hash(item["text"])} for item in messages]
    result["composer_hash"] = body_hash(composers[0])
    del result["composers"]
    return result


def evaluate_submission(observation: dict[str, object], expected_hash: str,
                        baseline: dict[str, object] | None = None, preflight: bool = False) -> dict[str, object]:
    if "status" in observation:
        return {"status": observation["status"], "reason": observation["reason"]}
    messages = observation["messages"]
    if preflight:
        if observation["composer_hash"] != expected_hash:
            return {"status": "incomplete", "reason": "composer_full_text_mismatch"}
        if any(item["hash"] == expected_hash for item in messages):
            return {"status": "uncertain", "reason": "expected_body_already_present"}
        return {"status": "ready", "reason": "composer_full_text_verified"}
    if not baseline:
        return {"status": "uncertain", "reason": "missing_preflight_baseline"}
    previous = baseline["messages"]
    if messages[:len(previous)] != previous or len(messages) < len(previous):
        return {"status": "uncertain", "reason": "history_changed_or_virtualized"}
    added = messages[len(previous):]
    if len(added) != 1:
        return {"status": "uncertain", "reason": "no_new_user_message" if not added else "multiple_new_user_messages"}
    if added[0]["id"] and any(item["id"] == added[0]["id"] for item in previous):
        return {"status": "uncertain", "reason": "duplicate_message_id"}
    if added[0]["hash"] != expected_hash:
        return {"status": "incomplete", "reason": "new_user_full_text_mismatch"}
    return {"status": "sent", "reason": "one_new_user_full_text_verified"}


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
        minimum,
    )
    passed = result["passed"] is True
    print(json.dumps({"ok": passed, **result}, ensure_ascii=False))
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


def same_submission_context(before: str, after: str, previous_messages: list[object]) -> bool:
    if before == after:
        return True
    if previous_messages or not trusted_chatgpt_url(before) or not trusted_chatgpt_url(after):
        return False
    source, target = urlsplit(before), urlsplit(after)
    project = re.fullmatch(r"(/g/[^/]+)/project/?", source.path)
    # 只接受已观测的同 Project 首页 -> 同路径 /c/<id> 首次导航，不构造目标 URL。
    return bool(project and source.netloc == target.netloc and not source.query and not source.fragment
                and not target.query and not target.fragment
                and re.fullmatch(re.escape(project.group(1)) + r"/c/[^/]+/?", target.path))


def check_message(
    session: str, cdp: str | None, tab: str | None, marker: str,
    timeout: float, interval: float, *, expected_file: str | None = None,
    user_selector: str | None = None, conversation_selector: str | None = None,
    baseline_file: str | None = None, preflight: bool = False,
) -> int:
    """只读观察；ready 不发送，sent 不表示 assistant 已完成，也从不允许自动重发。"""
    result: dict[str, object] = {"status": "uncertain", "reason": "missing_full_text_or_discovered_selectors"}
    try:
        if not math.isfinite(timeout) or not math.isfinite(interval) or not 0 <= timeout <= 300 or not 0 < interval <= 30:
            raise ValueError("invalid bounded polling")
        if not (expected_file and user_selector and conversation_selector and baseline_file and tab):
            # 兼容 marker-only CLI，但不读取全页线索并将其提升成成功。
            print(json.dumps({"ok": False, **result, "retry_safe": False}, ensure_ascii=False))
            return 1
        expected = Path(expected_file).read_text(encoding="utf-8")
        if not expected:
            raise ValueError("empty expected body")
        expected_digest = body_hash(expected)
        binding = {"version": 1, "session": session, "cdp": cdp, "tab": tab,
                   "user_selector": user_selector, "conversation_selector": conversation_selector,
                   "expected_hash": expected_digest}
        baseline = None
        if not preflight:
            baseline = json.loads(Path(baseline_file).read_text(encoding="utf-8"))
            if (not isinstance(baseline, dict) or any(baseline.get(key) != value for key, value in binding.items())
                    or not isinstance(baseline.get("messages"), list)
                    or not isinstance(baseline.get("url"), str)
                    or not isinstance(baseline.get("created_at"), (int, float))
                    or not 0 <= time.time() - baseline["created_at"] <= 900):
                raise ValueError("invalid or expired preflight baseline")
            if any(not isinstance(item, dict) or set(item) != {"id", "hash"}
                   or not isinstance(item["hash"], str)
                   or (item["id"] is not None and not isinstance(item["id"], str)) for item in baseline["messages"]):
                raise ValueError("invalid message baseline")
            if any(item["hash"] == expected_digest for item in baseline["messages"]):
                raise ValueError("expected body predates baseline")
        deadline = time.monotonic() + timeout
        # 时间上限和次数上限同时存在；即使时钟/读取 mock 异常也不能无限等待。
        attempts = min(301, math.ceil(timeout / interval) + 1)
        for attempt in range(attempts):
            observation = read_message_observation(session, cdp, tab, user_selector, conversation_selector)
            if (baseline and "status" not in observation
                    and not same_submission_context(baseline["url"], observation["url"], baseline["messages"])):
                result = {"status": "uncertain", "reason": "conversation_url_changed"}
                break
            result = evaluate_submission(observation, expected_digest, baseline, preflight)
            if preflight and result["status"] == "ready":
                # exclusive create 防止覆盖一个已用于提交的基线；恢复轮询必须复用原文件。
                payload = {**binding, "url": observation["url"], "messages": observation["messages"], "created_at": time.time()}
                with Path(baseline_file).open("x", encoding="utf-8") as handle:
                    json.dump(payload, handle, ensure_ascii=False)
            if preflight or result["status"] in {"sent", "interrupted"} or time.monotonic() >= deadline or attempt + 1 == attempts:
                break
            time.sleep(min(interval, max(0, deadline - time.monotonic())))
    except (OSError, RuntimeError, ValueError, TypeError, KeyError):
        # 不回显 CLI 错误、selector 或正文，避免意外泄漏输入。
        result = {"status": "uncertain", "reason": "read_or_baseline_validation_failed"}
    print(json.dumps({"ok": result["status"] in {"ready", "sent"}, **result, "retry_safe": False}, ensure_ascii=False))
    if result["status"] in {"ready", "sent"}:
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

    message_parser = subparsers.add_parser("message", help="只读核对 composer/本次用户消息全文；从不发送或重发。")
    message_parser.add_argument("--marker", default="", help="旧命令兼容占位；完整流程不消费此参数，无独立证明力。")
    message_parser.add_argument("--expected-file", help="UTF-8 期望正文临时文件，不输出正文。")
    message_parser.add_argument("--user-selector", help="现场发现的完整用户消息正文 CSS selector（不得含 assistant）。")
    message_parser.add_argument("--conversation-selector", help="现场发现的唯一完整对话根 CSS selector。")
    message_parser.add_argument("--baseline-file", help="preflight 新建的基线文件；提交后只读复用，有效期 15 分钟。")
    message_parser.add_argument("--preflight", action="store_true", help="仅核对发送前全文并保存基线，返回 ready；不发送。")
    message_parser.add_argument("--timeout", type=float, default=20)
    message_parser.add_argument("--interval", type=float, default=2)
    args = parser.parse_args()
    try:
        args.cdp = resolve_cdp(args.cdp)
        verify_cdp_connection(args.session, args.cdp)
    except (CdpConfigurationError, CdpConnectionError, argparse.ArgumentTypeError) as error:
        print(json.dumps({"ok": False, **({"status": "uncertain", "retry_safe": False} if args.command == "message" else {}),
                          "error": f"{error}\n{cdp_setup_guidance()}"}, ensure_ascii=False))
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
        return check_message(args.session, args.cdp, args.tab, args.marker, args.timeout, args.interval,
                             expected_file=args.expected_file, user_selector=args.user_selector,
                             conversation_selector=args.conversation_selector, baseline_file=args.baseline_file,
                             preflight=args.preflight)
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
