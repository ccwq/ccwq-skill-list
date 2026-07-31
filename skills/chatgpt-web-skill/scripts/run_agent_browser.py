#!/usr/bin/env python3
"""以当前项目会话和可选 CDP 配置调用 agent-browser CLI。"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def default_session_name() -> str:
    """生成不含路径分隔符的当前项目默认会话名。"""
    return Path.cwd().resolve().as_posix().replace("/", "")


def parse_port(value: str) -> str:
    """仅接受有效端口，避免把无效配置传给 CLI。"""
    try:
        port = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("CDP port 必须是 1 到 65535 的整数") from error
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("CDP port 必须是 1 到 65535 的整数")
    return str(port)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="使用可选 CDP 配置运行 agent-browser。",
    )
    parser.add_argument(
        "--session",
        default=os.environ.get("AGENT_BROWSER_SESSION") or default_session_name(),
        help="agent-browser session；默认由当前项目路径派生。",
    )
    parser.add_argument(
        "--cdp",
        type=parse_port,
        default=os.environ.get("AGENT_BROWSER_CDP_PORT"),
        help="已有浏览器的 CDP 端口；未设置时不传 --cdp。",
    )
    parser.add_argument("agent_browser_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    if not args.agent_browser_args:
        parser.error("请提供 agent-browser 命令，例如：tabs 或 snapshot -i")

    command = ["npx", "-y", "agent-browser", "--session", args.session]
    if args.cdp:
        command.extend(["--cdp", args.cdp])
    command.extend(args.agent_browser_args)

    # 保留 agent-browser 的 stdin/stdout/stderr，方便调用方读取实时快照。
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
