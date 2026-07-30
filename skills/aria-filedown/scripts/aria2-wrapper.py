#!/usr/bin/env python3
"""发现、按需安装并调用 aria2c；代理配置始终保持脱敏。"""

import argparse
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path


ARIA2_VERSION = "1.37.0"
RELEASE_BASE = f"https://github.com/aria2/aria2/releases/download/release-{ARIA2_VERSION}"
PROGRESS_MODES = {"auto", "tty", "jsonl", "off"}
RETRY_ROUNDS = 2
RETRIES_PER_ROUND = 2
RETRY_WAIT_SECONDS = 10
ROUND_WAIT_SECONDS = 25
DEFAULT_PROXY_HINTS = (
    "http://localhost:7897",
    "socks5://localhost:7897",
    "http://host.docker.internal:7897",
    "socks5://host.docker.internal:7897",
)


def system_type():
    return {"windows": "windows", "linux": "linux"}.get(platform.system().lower(), "unknown")


def binary_name():
    return "aria2c.exe" if system_type() == "windows" else "aria2c"


def release_filename():
    if system_type() == "windows":
        return f"aria2-{ARIA2_VERSION}-win-64bit-build1.zip"
    if system_type() == "linux":
        return f"aria2-{ARIA2_VERSION}.tar.xz"
    return None


def is_executable(path):
    return path is not None and path.is_file() and os.access(path, os.X_OK)


def make_executable(path):
    if system_type() != "windows":
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def find_aria2(explicit_dir=None):
    env_bin = os.environ.get("ARIA2C_BIN")
    if env_bin:
        candidate = Path(env_bin).expanduser().resolve()
        if is_executable(candidate):
            return candidate, "ARIA2C_BIN"

    from_path = shutil.which(binary_name())
    if from_path:
        candidate = Path(from_path).expanduser().resolve()
        if is_executable(candidate):
            return candidate, "PATH"

    install_dir = explicit_dir or os.environ.get("ARIA2C")
    if install_dir:
        candidate = Path(install_dir).expanduser().resolve() / binary_name()
        if is_executable(candidate):
            return candidate, "ARIA2C"
    return None, None


def project_root(cwd=None):
    cwd = Path(cwd or Path.cwd()).resolve()
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"], cwd=cwd, text=True,
            capture_output=True, check=False,
        )
    except OSError:
        return cwd
    if result.returncode == 0 and result.stdout.strip():
        return Path(result.stdout.strip()).resolve()
    return cwd


def read_dotenv(path):
    """读取最小 .env 子集；不做变量展开，避免把配置意外带入日志。"""
    values = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if key not in {"ARIA2_PROXY", "PROXY"}:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def resolve_proxy(explicit_proxy=None, environ=None, root=None):
    """返回 (proxy, source)，source 从不含代理值。"""
    if explicit_proxy:
        return explicit_proxy, "命令行 --proxy/-p"
    environ = os.environ if environ is None else environ
    for key in ("ARIA2_PROXY", "PROXY"):
        if environ.get(key):
            return environ[key], f"进程环境 {key}"
    values = read_dotenv(Path(root or project_root()) / ".env")
    for key in ("ARIA2_PROXY", "PROXY"):
        if values.get(key):
            return values[key], f"项目 .env 的 {key}"
    return None, "未配置"


def redact_proxy(proxy):
    if not proxy:
        return ""
    parsed = urllib.parse.urlsplit(proxy)
    if parsed.username or parsed.password:
        host = parsed.hostname or ""
        if parsed.port:
            host = f"{host}:{parsed.port}"
        return f"{parsed.scheme}://***@{host}"
    return proxy


def redact_command(command):
    protected = ("--all-proxy=", "--http-proxy=", "--https-proxy=")
    return " ".join(
        f"{item.split('=', 1)[0]}={redact_proxy(item.split('=', 1)[1])}"
        if item.startswith(protected) else item
        for item in command
    )


def proxy_opener(proxy):
    if not proxy:
        return urllib.request.build_opener()
    return urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))


def download_file(url, destination, proxy=None, sleep=time.sleep):
    """下载 bootstrap 包；只重试网络/I/O 故障。"""
    last_error = None
    for round_index in range(RETRY_ROUNDS):
        for attempt in range(RETRIES_PER_ROUND):
            try:
                with proxy_opener(proxy).open(url) as response, open(destination, "wb") as output:
                    shutil.copyfileobj(response, output)
                return
            except (urllib.error.URLError, OSError) as error:
                last_error = error
                is_last = round_index == RETRY_ROUNDS - 1 and attempt == RETRIES_PER_ROUND - 1
                if is_last:
                    break
                print(f"aria2 安装包下载失败，将重试（第 {round_index + 1} 轮第 {attempt + 1} 次）。", file=sys.stderr)
                sleep(ROUND_WAIT_SECONDS if attempt == RETRIES_PER_ROUND - 1 else RETRY_WAIT_SECONDS)
    raise last_error


def extract_archive(archive_path, install_dir):
    install_dir.mkdir(parents=True, exist_ok=True)
    target = install_dir / binary_name()
    if system_type() == "windows":
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.namelist():
                if member.endswith(binary_name()):
                    with archive.open(member) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output)
                    break
    elif system_type() == "linux":
        with tarfile.open(archive_path, "r:xz") as archive:
            for member in archive.getmembers():
                if member.name.endswith(binary_name()):
                    source = archive.extractfile(member)
                    if source:
                        with source, target.open("wb") as output:
                            shutil.copyfileobj(source, output)
                    break
    if not target.is_file():
        raise FileNotFoundError(f"解压后未找到 {binary_name()}")
    make_executable(target)
    return target


def install_aria2(install_dir, proxy=None, sleep=time.sleep):
    filename = release_filename()
    if not filename:
        print(f"当前系统不支持自动安装 aria2: {system_type()}", file=sys.stderr)
        return None
    install_dir = Path(install_dir).expanduser().resolve()
    install_dir.mkdir(parents=True, exist_ok=True)
    archive = install_dir / filename
    try:
        download_file(f"{RELEASE_BASE}/{filename}", archive, proxy=proxy, sleep=sleep)
        return extract_archive(archive, install_dir)
    except (urllib.error.URLError, OSError, tarfile.TarError, zipfile.BadZipFile, FileNotFoundError) as error:
        print(f"aria2 安装失败: {error}", file=sys.stderr)
        print("可提供 --proxy/-p 后重试；例如 http://localhost:7897。", file=sys.stderr)
        return None
    finally:
        if archive.exists():
            archive.unlink()


def append_defaults(command):
    if "-s" not in command and "--split" not in command:
        command.extend(["-s", "10"])
    if "-x" not in command and "--max-connection-per-server" not in command:
        command.extend(["-x", "10"])
    if "-c" not in command and "--continue=true" not in command:
        command.append("-c")


def emit_json(event_type, returncode=None):
    payload = {"type": event_type, "timestamp": int(time.time())}
    if returncode is not None:
        payload["returncode"] = returncode
    print(json.dumps(payload, ensure_ascii=False))


def run_download(binary, download_args, proxy, proxy_source, progress):
    command = [str(binary), *download_args]
    if proxy:
        command.append(f"--all-proxy={proxy}")
    append_defaults(command)
    print(f"代理来源: {proxy_source}")
    if progress == "jsonl":
        emit_json("started")
    elif progress != "off":
        print(f"执行命令: {redact_command(command)}")
    result = subprocess.run(command)
    if progress == "jsonl":
        emit_json("completed" if result.returncode == 0 else "error", result.returncode)
    elif result.returncode != 0:
        print(f"aria2 执行失败(exit={result.returncode})", file=sys.stderr)
    return result.returncode


def build_parser():
    parser = argparse.ArgumentParser(description="发现、安装并调用 aria2c 的包装脚本。")
    parser.add_argument("--check", action="store_true", help="仅检查 aria2c，不下载。")
    parser.add_argument("--install", action="store_true", help="缺少 aria2c 时安装。")
    parser.add_argument("--install-dir", help="aria2 安装目录；默认读取 ARIA2C。")
    parser.add_argument("--proxy", "-p", help="代理地址；优先级最高。")
    parser.add_argument("--progress", choices=sorted(PROGRESS_MODES), default="auto")
    parser.add_argument("download_args", nargs=argparse.REMAINDER, help="透传给 aria2c 的参数。")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    download_args = list(args.download_args)
    if download_args[:1] == ["--"]:
        download_args.pop(0)
    proxy, proxy_source = resolve_proxy(args.proxy)
    binary, source = find_aria2(args.install_dir)
    if args.check:
        print(f"aria2c: {binary}" if binary else "未找到可用 aria2c")
        return 0 if binary else 1
    if not binary and args.install:
        target_dir = args.install_dir or os.environ.get("ARIA2C")
        if not target_dir:
            print("未设置安装目录；请先获得用户对 ./bin/aria 或 --install-dir 的明确确认。", file=sys.stderr)
            return 2
        binary = install_aria2(target_dir, proxy=proxy)
    if not binary:
        print("aria2 不可用，无法执行下载。", file=sys.stderr)
        return 2
    if not download_args:
        print(f"最终使用的 aria2c: {binary} (source={source or 'download'})")
        return 0
    return run_download(binary, download_args, proxy, proxy_source, args.progress)


if __name__ == "__main__":
    raise SystemExit(main())
