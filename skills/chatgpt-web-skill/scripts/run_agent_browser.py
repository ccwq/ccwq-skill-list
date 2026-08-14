#!/usr/bin/env python3
"""以当前项目会话和可选 CDP 配置调用 agent-browser CLI。"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Sequence
from urllib.parse import urlsplit
from urllib.request import urlopen


DEFAULT_CDP_PORT = "9222"


class CdpConfigurationError(ValueError):
    """表示 CDP 配置缺失或格式不正确。"""


class CdpConnectionError(RuntimeError):
    """表示无法连接到指定的既有浏览器。"""


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


def parse_cdp(value: str) -> str:
    """接受 agent-browser 的本地端口或完整 CDP URL。"""
    value = value.strip()
    if not value:
        raise argparse.ArgumentTypeError("CDP 必须是端口或 http://ip:port URL")
    try:
        port = int(value)
    except ValueError:
        parsed = urlsplit(value)
        try:
            has_valid_port = parsed.port is not None
        except ValueError:
            has_valid_port = False
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or not has_valid_port:
            raise argparse.ArgumentTypeError("CDP 必须是 1 到 65535 的端口，或带端口的 http(s) URL")
        return value
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("CDP 端口必须是 1 到 65535 的整数")
    return str(port)


def user_config_path() -> Path:
    """返回 agent-browser 跨平台的用户级配置路径。"""
    return Path.home() / ".agent-browser" / "config.json"


def configured_cdp() -> str | None:
    """只读取用户级 agent-browser 配置，避免项目配置改变 skill 的既有浏览器。"""
    config_path = user_config_path()
    if not config_path.is_file():
        return None
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CdpConfigurationError(f"无法读取 agent-browser 配置文件：{config_path}") from error
    if not isinstance(config, dict) or "cdp" not in config:
        return None
    raw_cdp = config["cdp"]
    if not isinstance(raw_cdp, (str, int)):
        raise CdpConfigurationError("agent-browser 配置的 cdp 必须是端口或 URL")
    try:
        return parse_cdp(str(raw_cdp))
    except argparse.ArgumentTypeError as error:
        raise CdpConfigurationError(str(error)) from error


def resolve_cdp(explicit: str | None) -> str:
    """按调用参数、环境变量、用户级配置和默认端口解析 CDP。"""
    if explicit:
        return explicit
    environment_cdp = os.environ.get("AGENT_BROWSER_CDP_PORT")
    if environment_cdp:
        return parse_cdp(environment_cdp)
    return configured_cdp() or DEFAULT_CDP_PORT


def cdp_setup_guidance() -> str:
    """给出无连接时可直接执行的跨平台配置说明。"""
    return (
        "CDP 连接失败，未启动新浏览器。优先级：--cdp/-c > AGENT_BROWSER_CDP_PORT > "
        f"{user_config_path()} > {DEFAULT_CDP_PORT}。\n"
        "推荐直接传入：python scripts/run_agent_browser.py --cdp 9222 tab list\n"
        "也可设置环境变量：AGENT_BROWSER_CDP_PORT=9222\n"
        f"或在 {user_config_path()} 写入：{{\"cdp\": 9222}}"
    )


def cdp_discovery_url(cdp: str) -> str:
    """将端口或 HTTP CDP 地址规范为 /json/version 发现地址。"""
    if cdp.isdigit():
        return f"http://127.0.0.1:{cdp}/json/version"
    parsed = urlsplit(cdp)
    return f"{parsed.scheme}://{parsed.netloc}/json/version"


def discover_cdp_websocket_url(cdp: str) -> str:
    """读取目标 CDP discovery，确保连接的是指定浏览器而非默认 session。"""
    try:
        with urlopen(cdp_discovery_url(cdp), timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise CdpConnectionError("CDP /json/version discovery 失败") from error
    websocket_url = payload.get("webSocketDebuggerUrl") if isinstance(payload, dict) else None
    if not isinstance(websocket_url, str) or not websocket_url:
        raise CdpConnectionError("CDP discovery 未返回 webSocketDebuggerUrl")
    return websocket_url


def same_cdp_target(expected_websocket_url: str, actual_output: str) -> bool:
    """按 host 与端口核验 agent-browser 已绑定刚发现的 CDP 目标。"""
    match = re.search(r"(?:ws|wss|http|https)://[^\s\"']+", actual_output)
    if not match:
        return False
    expected = urlsplit(expected_websocket_url)
    actual = urlsplit(match.group(0))
    if expected.port != actual.port:
        return False
    local_hosts = {"127.0.0.1", "localhost", "::1"}
    return expected.hostname == actual.hostname or {expected.hostname, actual.hostname}.issubset(local_hosts)


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
    """构造已绑定既有 CDP session 的 agent-browser 命令。"""
    command = list(command_prefix or cli_prefix())
    if session:
        command.extend(["--session", session])
    command.extend(args)
    return command


def verify_cdp_connection(session: str | None, cdp: str) -> None:
    """发现并验证既有 CDP，再让 agent-browser 绑定同一目标。"""
    websocket_url = discover_cdp_websocket_url(cdp)
    connect_result = subprocess.run(
        build_command(session, None, ["connect", websocket_url]),
        check=False,
        capture_output=True,
        text=True,
    )
    if connect_result.returncode != 0:
        raise CdpConnectionError("agent-browser connect 失败")
    cdp_url_result = subprocess.run(
        build_command(session, None, ["get", "cdp-url"]),
        check=False,
        capture_output=True,
        text=True,
    )
    if cdp_url_result.returncode != 0 or not same_cdp_target(websocket_url, cdp_url_result.stdout):
        raise CdpConnectionError("agent-browser 未绑定到已发现的 CDP 目标")
    result = subprocess.run(
        build_command(session, None, ["tab", "list"]),
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise CdpConnectionError("agent-browser 无法列出 CDP 标签页")


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
        "--cdp", "-c",
        type=parse_cdp,
        help="既有浏览器的 CDP 端口或 http(s) URL。",
    )
    parser.add_argument(
        "--tab",
        help="每次命令前切换到的稳定 agent-browser tab ID。",
    )
    parser.add_argument("agent_browser_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    try:
        args.cdp = resolve_cdp(args.cdp)
        verify_cdp_connection(args.session, args.cdp)
    except (CdpConfigurationError, CdpConnectionError, argparse.ArgumentTypeError) as error:
        print(f"{error}\n{cdp_setup_guidance()}", file=sys.stderr)
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
