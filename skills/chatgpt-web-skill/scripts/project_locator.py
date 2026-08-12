#!/usr/bin/env python3
"""通过已登录 ChatGPT tab 的实时 sidebar DOM 定位并打开 Project 主页。"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Sequence

from run_agent_browser import build_command, load_project_env, parse_port, session_for_cdp
from runtime_checks import evaluate_project
from browser_task import acquire_task, release_task


def load_skill_env() -> None:
    """加载 skill 内部的非敏感默认值，调用期环境变量优先。"""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if key and value and key not in os.environ:
            os.environ[key] = value.strip().strip("\"'")


def positive_float(value: str) -> float:
    """解析必须大于零的超时/间隔配置。"""
    try:
        parsed = float(value)
    except ValueError as error:
        raise ValueError("超时与轮询间隔必须是数字") from error
    if parsed <= 0:
        raise ValueError("超时与轮询间隔必须大于 0")
    return parsed


LOCATOR_EXPRESSION = r"""
(name => {
  const visible = element => Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  const rows = Array.from(document.querySelectorAll('[class~="group/project-unfurl-row"]'));
  const matches = rows.filter(row => {
    const item = row.querySelector('[role="button"][data-sidebar-item]');
    return visible(row) && item && item.textContent.trim() === name;
  });
  return JSON.stringify({
    project: name,
    matchCount: matches.length,
    hasHomeControl: matches.length === 1 && Boolean(matches[0].querySelector('button[aria-label="Open project home"]'))
  });
})(%s)
"""


def run_cli(session: str, cdp: str, args: Sequence[str], tab: str | None = None, input_text: str | None = None) -> str:
    if tab:
        selected = subprocess.run(
            build_command(session, cdp, ["tab", tab]),
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if selected.returncode != 0:
            raise RuntimeError(selected.stderr.strip() or selected.stdout.strip() or f"无法切换到 tab {tab}")
    command = list(args)
    stdin = input_text
    if len(command) == 2 and command[0] == "eval":
        stdin = command[1]
        command = ["--json", "eval", "--stdin"]
    result = subprocess.run(
        build_command(session, cdp, command),
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        input=stdin,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"agent-browser exit {result.returncode}")
    return result.stdout.strip()


def parse_json(output: str) -> dict[str, object]:
    decoder = json.JSONDecoder()
    for index, char in enumerate(output):
        if char not in "[{\"":
            continue
        try:
            value, _ = decoder.raw_decode(output[index:])
        except json.JSONDecodeError:
            continue
        found = find_object(value)
        if found is not None:
            return found
    raise ValueError("无法解析 agent-browser eval JSON")


def find_object(value: object) -> dict[str, object] | None:
    """递归解开 CLI 的 JSON 包装，返回 locator 自身的对象。"""
    if isinstance(value, str):
        try:
            return find_object(json.loads(value))
        except json.JSONDecodeError:
            return None
    if isinstance(value, dict):
        if "matchCount" in value or "clicked" in value:
            return value
        for nested in value.values():
            found = find_object(nested)
            if found is not None:
                return found
    if isinstance(value, list):
        for nested in value:
            found = find_object(nested)
            if found is not None:
                return found
    return None


def locate_and_click(
    session: str,
    cdp: str,
    tab: str,
    project: str,
    evidence_deadline: float | None = None,
    interval: float = 1.0,
) -> dict[str, object]:
    expression = LOCATOR_EXPRESSION % json.dumps(project, ensure_ascii=False)
    discovery = parse_json(run_cli(session, cdp, ["eval", expression], tab))
    if discovery.get("matchCount") != 1:
        raise LookupError(f"未找到唯一可见 Project：{project}（matchCount={discovery.get('matchCount')}）")
    if discovery.get("hasHomeControl") is not True:
        raise LookupError(f"Project 行缺少 Open project home 控件：{project}")

    click_expression = r"""
    (name => {
      const rows = Array.from(document.querySelectorAll('[class~="group/project-unfurl-row"]'));
      const matches = rows.filter(row => {
        const item = row.querySelector('[role="button"][data-sidebar-item]');
        return item && item.textContent.trim() === name;
      });
      if (matches.length !== 1) throw new Error(`Project 行数量变化：${matches.length}`);
      const control = matches[0].querySelector('button[aria-label="Open project home"]');
      if (!control) throw new Error('Open project home 控件消失');
      control.click();
      return JSON.stringify({clicked: true, project: name});
    })(%s)
    """ % json.dumps(project, ensure_ascii=False)
    parse_json(run_cli(session, cdp, ["eval", click_expression], tab))
    deadline = evidence_deadline or (time.monotonic() + 2.0)
    result: dict[str, object] = {}
    while True:
        url = run_cli(session, cdp, ["get", "url"], tab)
        title = run_cli(session, cdp, ["get", "title"], tab)
        snapshot = run_cli(session, cdp, ["snapshot", "-i"], tab)
        result = evaluate_project(url, title, snapshot, project)
        if "project_url" in result["evidence"] and int(result["evidence_count"]) >= 2:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError(f"跳转后 Project 证据不足：{json.dumps(result, ensure_ascii=False)}")
        time.sleep(interval)
    return {"ok": True, **result}


def open_from_new_tab(session: str, cdp: str, project: str, timeout: float, interval: float) -> dict[str, object]:
    """新建 ChatGPT tab 后定位 Project，并返回 lease 供调用方在终态释放。"""
    lease = acquire_task(session, cdp, "https://chatgpt.com/", force_new=True)
    tab = str(lease["tab_id"])
    deadline = time.monotonic() + timeout
    # 新 tab 的 sidebar 异步渲染；只重试“尚未发现行”，其余错误立即上抛。
    try:
        while True:
            try:
                result = locate_and_click(session, cdp, tab, project, deadline, interval)
                break
            except LookupError as error:
                if "matchCount=0" not in str(error) or time.monotonic() >= deadline:
                    raise
                time.sleep(interval)
    except Exception:
        release_task(str(lease["lease"]), purge=False)
        raise
    return {**result, "tab_id": tab, "created_tab": True, "lease": lease["lease"]}


def main() -> int:
    load_project_env()
    load_skill_env()
    parser = argparse.ArgumentParser(description="从 ChatGPT sidebar 定位并打开 Project 主页。")
    parser.add_argument("--name", default="agents-op", help="精确匹配的 Project 名称。")
    parser.add_argument("--session", default=session_for_cdp())
    parser.add_argument("--cdp", type=parse_port, default=os.environ.get("AGENT_BROWSER_CDP_PORT"))
    tab_group = parser.add_mutually_exclusive_group(required=True)
    tab_group.add_argument("--tab", help="复用的已登录 ChatGPT tab ID。")
    tab_group.add_argument(
        "--new-tab",
        action="store_true",
        help="通过 agent-browser 新建 ChatGPT tab，并返回需由调用方释放的 lease。",
    )
    parser.add_argument(
        "--new-tab-timeout",
        type=positive_float,
        default=positive_float(os.environ.get("CHATGPT_PROJECT_LOCATOR_NEW_TAB_TIMEOUT_SECONDS", "30")),
        help="--new-tab 的总超时秒数；默认读取 skill .env。",
    )
    parser.add_argument(
        "--new-tab-interval",
        type=positive_float,
        default=positive_float(os.environ.get("CHATGPT_PROJECT_LOCATOR_NEW_TAB_INTERVAL_SECONDS", "1")),
        help="--new-tab 轮询间隔秒数；默认读取 skill .env。",
    )
    args = parser.parse_args()
    if not args.cdp:
        print(json.dumps({"ok": False, "error": "未配置已登录浏览器 CDP，拒绝启动新的浏览器会话。"}, ensure_ascii=False))
        return 2
    try:
        if args.new_tab:
            result = open_from_new_tab(args.session, args.cdp, args.name, args.new_tab_timeout, args.new_tab_interval)
        else:
            result = locate_and_click(args.session, args.cdp, args.tab, args.name)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (LookupError, OSError, RuntimeError, ValueError) as error:
        print(json.dumps({"ok": False, "project": args.name, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
