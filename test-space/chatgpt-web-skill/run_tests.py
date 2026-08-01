from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[2] / "skills" / "chatgpt-web-skill" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from experience_memory import append_entry, entry_count, expected_header, status  # noqa: E402
from run_agent_browser import build_command, cli_prefix  # noqa: E402
from runtime_checks import (  # noqa: E402
    check_images,
    composer_expression,
    evaluate_message,
    evaluate_project,
    extract_json_array,
    has_visual_image_evidence,
    image_expression,
    run_cli,
)


class RunAgentBrowserTests(unittest.TestCase):
    def test_cdp_is_optional(self) -> None:
        command_prefix = ["agent-browser"]
        self.assertNotIn("--cdp", build_command("session", None, ["tab", "list"], command_prefix))
        self.assertEqual(
            build_command("session", "9222", ["tab", "list"], command_prefix),
            ["agent-browser", "--session", "session", "--cdp", "9222", "tab", "list"],
        )
        self.assertEqual(
            build_command("session", None, ["tab", "task-tab"], command_prefix),
            ["agent-browser", "--session", "session", "tab", "task-tab"],
        )

    def test_installed_cli_is_preferred_over_npx(self) -> None:
        with patch("run_agent_browser.shutil.which", return_value="agent-browser.cmd"):
            self.assertEqual(cli_prefix(), ["agent-browser.cmd"])
        with patch("run_agent_browser.shutil.which", return_value=None):
            self.assertEqual(cli_prefix(), ["npx", "-y", "agent-browser"])


class RuntimeChecksTests(unittest.TestCase):
    def test_project_requires_live_evidence(self) -> None:
        result = evaluate_project(
            "https://chatgpt.com/g/example/project",
            "ChatGPT - agents-op",
            "textbox New chat in agents-op",
            "agents-op",
        )
        self.assertEqual(result["evidence_count"], 3)

    def test_image_output_parser(self) -> None:
        output = 'prefix [{"naturalWidth":1254,"naturalHeight":1254}] suffix'
        self.assertEqual(extract_json_array(output)[0]["naturalWidth"], 1254)
        mixed_output = 'diagnostic [not-json] result [{"naturalWidth":1254}]'
        self.assertEqual(extract_json_array(mixed_output)[0]["naturalWidth"], 1254)
        wrapped_output = '{"result":"[{\\\"naturalWidth\\\":1254}]"}'
        self.assertEqual(extract_json_array(wrapped_output)[0]["naturalWidth"], 1254)
        self.assertIn("naturalWidth>=1000", image_expression('img[alt^="Generated image"]', 1000))
        self.assertTrue(has_visual_image_evidence('image "Generated image: blue square"', "Generated image"))
        self.assertFalse(has_visual_image_evidence('button Create image', "Generated image"))

    def test_message_status_distinguishes_pending_sent_and_login(self) -> None:
        marker = "unique-marker"
        sent = evaluate_message("https://chatgpt.com/g/x/project", marker, "", marker)
        self.assertEqual(sent["status"], "sent")
        pending = evaluate_message("https://chatgpt.com/g/x/project", marker, marker, marker)
        self.assertEqual(pending["status"], "pending")
        interrupted = evaluate_message("https://proxy.example/login", marker, "", marker)
        self.assertEqual(interrupted["status"], "interrupted")
        self.assertIn("contenteditable", composer_expression())

    def test_runtime_check_reselects_tab_before_each_read(self) -> None:
        with patch(
            "runtime_checks.subprocess.run",
            side_effect=[
                CompletedProcess(["tab", "task"], 0, "", ""),
                CompletedProcess(["get", "url"], 0, "https://chatgpt.com", ""),
            ],
        ) as runner:
            self.assertEqual(run_cli("session", None, ["get", "url"], "task"), "https://chatgpt.com")
        self.assertEqual(runner.call_args_list[0].args[0][-2:], ["tab", "task"])
        self.assertEqual(runner.call_args_list[1].args[0][-2:], ["get", "url"])

    def test_runtime_check_sends_eval_through_stdin(self) -> None:
        expression = 'Array.from(document.querySelectorAll("[contenteditable=true]"))'
        with patch(
            "runtime_checks.subprocess.run",
            return_value=CompletedProcess(["eval"], 0, "[]", ""),
        ) as runner:
            self.assertEqual(run_cli("session", None, ["eval", expression]), "[]")
        self.assertEqual(runner.call_args.args[0][-2:], ["eval", "--stdin"])
        self.assertIn("--json", runner.call_args.args[0])
        self.assertEqual(runner.call_args.kwargs["input"], expression)

    def test_visible_image_skips_dimension_polling(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            screenshot = str(Path(temporary) / "image.png")
            with patch(
                "runtime_checks.run_cli",
                side_effect=['image "Generated image: test"', "screenshot saved"],
            ) as runner:
                self.assertEqual(
                    check_images(
                        "session",
                        None,
                        "t42",
                        'img[alt^="Generated image"]',
                        1000,
                        180,
                        5,
                        screenshot,
                        "Generated image",
                    ),
                    0,
                )
        commands = [call.args[2] for call in runner.call_args_list]
        self.assertEqual(commands, [["snapshot", "-i"], ["screenshot", screenshot]])


class ExperienceMemoryTests(unittest.TestCase):
    def test_append_creates_valid_versioned_memory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "memory.md"
            result = append_entry(
                path,
                "1.6.0",
                "ref 恢复",
                "页面更新后旧 ref 失效",
                "重新 snapshot 后使用实时控件",
                "不得复用旧 ref",
                date(2026, 7, 31),
            )
            content = path.read_text(encoding="utf-8")
            self.assertTrue(content.startswith(expected_header("1.6.0")))
            self.assertEqual(entry_count(content), 1)
            self.assertEqual(result["entries"], 1)
            self.assertEqual(status(path, "1.6.0")["entries"], 1)

    def test_invalid_header_is_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "memory.md"
            path.write_text("invalid\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                append_entry(path, "1.6.0", "a", "b", "c", "d")
            self.assertEqual(path.read_text(encoding="utf-8"), "invalid\n")


if __name__ == "__main__":
    unittest.main()
