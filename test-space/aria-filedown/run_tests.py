"""aria-filedown 的离线回归测试。"""

import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
WRAPPER = ROOT / "skills" / "aria-filedown" / "scripts" / "aria2-wrapper.py"
SPEC = importlib.util.spec_from_file_location("aria2_wrapper", WRAPPER)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AriaFiledownTests(unittest.TestCase):
    def test_proxy_priority(self):
        """
        Given：命令行、进程环境和项目 .env 都提供代理
        When：解析最终代理
        Then：命令行代理优先且来源不泄露具体地址
        防回归：避免项目默认配置覆盖临时安全代理
        """
        with tempfile.TemporaryDirectory() as temp:
            Path(temp, ".env").write_text("ARIA2_PROXY=http://dotenv:secret@proxy\n", encoding="utf-8")
            proxy, source = MODULE.resolve_proxy("http://cli:secret@proxy", {"ARIA2_PROXY": "http://env:secret@proxy"}, temp)
        self.assertEqual("http://cli:secret@proxy", proxy)
        self.assertEqual("命令行 --proxy/-p", source)

    def test_env_specific_proxy_beats_generic_proxy(self):
        """
        Given：同一环境层同时设置 ARIA2_PROXY 与 PROXY
        When：解析代理
        Then：优先使用专用变量 ARIA2_PROXY
        防回归：避免通用代理意外改变 aria2 下载路径
        """
        proxy, source = MODULE.resolve_proxy(None, {"ARIA2_PROXY": "http://specific", "PROXY": "http://generic"}, ROOT)
        self.assertEqual("http://specific", proxy)
        self.assertEqual("进程环境 ARIA2_PROXY", source)

    def test_project_dotenv_is_fallback(self):
        """
        Given：进程环境未提供代理、项目 .env 提供 PROXY
        When：解析代理
        Then：使用项目 .env 的通用代理
        防回归：保证项目默认网络配置能被读取
        """
        with tempfile.TemporaryDirectory() as temp:
            Path(temp, ".env").write_text("PROXY='socks5://local'\n", encoding="utf-8")
            proxy, source = MODULE.resolve_proxy(None, {}, temp)
        self.assertEqual("socks5://local", proxy)
        self.assertEqual("项目 .env 的 PROXY", source)

    def test_project_root_prefers_git_root(self):
        """
        Given：包装器从项目的嵌套子目录运行
        When：Git 命令返回仓库根目录
        Then：.env 定位使用 Git 根目录而非调用子目录
        防回归：避免子目录下载时丢失项目统一代理配置
        """
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp, "repo")
            nested = root / "packages" / "app"
            nested.mkdir(parents=True)
            completed = subprocess.CompletedProcess([], 0, f"{root}\n", "")
            with patch.object(MODULE.subprocess, "run", return_value=completed):
                self.assertEqual(root.resolve(), MODULE.project_root(nested))

    def test_short_proxy_option_matches_long_option(self):
        """
        Given：用户使用代理短参数 -p
        When：解析命令行
        Then：得到与 --proxy 相同的代理值
        防回归：避免短参数文档存在但 argparse 未绑定
        """
        self.assertEqual("http://localhost:7897", MODULE.build_parser().parse_args(["-p", "http://localhost:7897"]).proxy)

    def test_command_redacts_proxy_credentials(self):
        """
        Given：代理 URL 包含用户名和密码
        When：格式化将回显的下载命令
        Then：凭据被遮蔽而主机信息仍可诊断
        防回归：避免日志泄露代理认证信息
        """
        rendered = MODULE.redact_command(["aria2c", "--all-proxy=http://alice:secret@localhost:7897"])
        self.assertNotIn("alice", rendered)
        self.assertNotIn("secret", rendered)
        self.assertIn("localhost:7897", rendered)

    def test_bootstrap_download_retries_by_policy(self):
        """
        Given：aria2 安装包下载连续失败
        When：执行 bootstrap 下载
        Then：按两轮每轮两次尝试，并使用规定等待间隔
        防回归：避免网络波动时只尝试一次就放弃
        """
        sleeps = []
        with tempfile.TemporaryDirectory() as temp, patch.object(MODULE, "proxy_opener", side_effect=OSError("offline")):
            with self.assertRaises(OSError):
                MODULE.download_file("https://example.invalid/a.zip", Path(temp, "a.zip"), sleep=sleeps.append)
        self.assertEqual([10, 25, 10], sleeps)


if __name__ == "__main__":
    unittest.main(verbosity=2)
