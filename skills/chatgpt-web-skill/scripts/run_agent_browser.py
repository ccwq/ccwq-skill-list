#!/usr/bin/env python3
"""以当前项目会话和可选 CDP 配置调用 agent-browser CLI。"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Sequence


def load_project_env(path: Path | None = None) -> None:
    """加载项目 .env 中的非敏感 CLI 配置，不覆盖调用期环境变量。"""
    env_path = path or Path(__file__).resolve().parents[3] / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if key and value and key not in os.environ:
            os.environ[key] = value.strip().strip("\"'")


load_project_env()


def default_session_name() -> str:
    """生成不含路径分隔符的当前项目默认会话名。"""
    return Path.cwd().resolve().as_posix().replace("/", "")


def session_for_cdp() -> str | None:
    """CDP 已由默认 agent-browser daemon 管理时不强行创建隔离 session。"""
    if os.environ.get("AGENT_BROWSER_USE_DEFAULT_CDP_SESSION", "").casefold() in {"1", "true", "yes"}:
        return None
    return os.environ.get("AGENT_BROWSER_SESSION") or default_session_name()


def parse_port(value: str) -> str:
    """仅接受有效端口，避免把无效配置传给 CLI。"""
    try:
        port = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("CDP port 必须是 1 到 65535 的整数") from error
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("CDP port 必须是 1 到 65535 的整数")
    return str(port)


def cli_prefix() -> list[str]:
    """优先复用 PATH 中的 CLI，保留其既有 daemon 会话上下文。"""
    installed_cli = shutil.which("agent-browser")
    if installed_cli:
        return [installed_cli]
    return ["npx", "-y", "agent-browser"]


def build_command(
    session: str | None,
    cdp: str | None,
    args: Sequence[str],
    command_prefix: Sequence[str] | None = None,
) -> list[str]:
    """构造 agent-browser 命令，只有配置端口时才附加 CDP 参数。"""
    command = list(command_prefix or cli_prefix())
    if session:
        command.extend(["--session", session])
    if cdp:
        command.extend(["--cdp", cdp])
    command.extend(args)
    return command


def main() -> int:
    load_project_env()
    parser = argparse.ArgumentParser(
        description="使用可选 CDP 配置运行 agent-browser。",
    )
    parser.add_argument(
        "--session",
        default=session_for_cdp(),
        help="agent-browser session；默认由当前项目路径派生。",
    )
    parser.add_argument(
        "--cdp",
        type=parse_port,
        default=os.environ.get("AGENT_BROWSER_CDP_PORT"),
        help="已有浏览器的 CDP 端口；未设置时不传 --cdp。",
    )
    parser.add_argument(
        "--tab",
        help="每次命令前切换到的稳定 agent-browser tab ID。",
    )
    parser.add_argument("agent_browser_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    if not args.cdp:
        print("未配置已登录浏览器 CDP，拒绝启动新的浏览器会话。", file=sys.stderr)
        return 2

    if not args.agent_browser_args:
        parser.error("请提供 agent-browser 命令，例如：tab list 或 snapshot -i")

    if args.tab:
        tab_result = subprocess.run(
            build_command(args.session, args.cdp, ["tab", args.tab]),
            check=False,
        )
        if tab_result.returncode != 0:
            return tab_result.returncode

    command = build_command(args.session, args.cdp, args.agent_browser_args)

    # 保留 agent-browser 的 stdin/stdout/stderr，方便调用方读取实时快照。
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
