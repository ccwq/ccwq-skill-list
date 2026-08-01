from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from subprocess import CompletedProcess
from typing import Any
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[2] / "skills" / "chatgpt-web-skill" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from experience_memory import append_entry, entry_count, expected_header, status, trim_entries  # noqa: E402
from run_agent_browser import build_command, cli_prefix, load_project_env  # noqa: E402
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
from browser_task import (  # noqa: E402
    acquire_task,
    action_task,
    normalize_url,
    parse_tab_list,
    release_task,
    status_task,
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

    def test_project_env_supplies_cdp_without_overriding_calling_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            env_path = Path(temporary) / ".env"
            env_path.write_text("AGENT_BROWSER_CDP_PORT=9696\n", encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                load_project_env(env_path)
                self.assertEqual(os.environ["AGENT_BROWSER_CDP_PORT"], "9696")
            with patch.dict(os.environ, {"AGENT_BROWSER_CDP_PORT": "9222"}, clear=True):
                load_project_env(env_path)
                self.assertEqual(os.environ["AGENT_BROWSER_CDP_PORT"], "9222")


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


class ScenarioRegressionTests(unittest.TestCase):
    """对应 LIVE_CASES.md 的四个主功能回归场景。"""

    def test_case_1_project_routing_needs_two_live_evidences(self) -> None:
        url_only = evaluate_project(
            "https://chatgpt.com/g/example/project",
            "ChatGPT",
            "textbox Ask anything",
            "agents-op",
        )
        confirmed = evaluate_project(
            "https://chatgpt.com/g/example/project",
            "ChatGPT - agents-op",
            "textbox New chat in agents-op",
            "agents-op",
        )
        self.assertEqual(url_only["evidence_count"], 1)
        self.assertLess(url_only["evidence_count"], 2)
        self.assertGreaterEqual(confirmed["evidence_count"], 2)

    def test_case_2_submit_requires_rendered_marker_not_enter_alone(self) -> None:
        marker = "case-2-unique-marker"
        after_enter = evaluate_message("https://chatgpt.com/g/example/project", "", marker, marker)
        after_realtime_send = evaluate_message(
            "https://chatgpt.com/g/example/project",
            f"user message {marker}",
            "",
            marker,
        )
        self.assertEqual(after_enter["status"], "pending")
        self.assertEqual(after_realtime_send["status"], "sent")

    def test_case_3_visible_image_screenshots_without_extra_polling(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            screenshot = str(Path(temporary) / "case-3-image.png")
            with patch(
                "runtime_checks.run_cli",
                side_effect=['image "Generated image: case 3"', "screenshot saved"],
            ) as runner:
                result = check_images(
                    "case-3-session",
                    None,
                    "t-case-3",
                    'img[alt^="Generated image"]',
                    1000,
                    180,
                    5,
                    screenshot,
                    "Generated image",
                )
        self.assertEqual(result, 0)
        self.assertEqual(
            [call.args[2] for call in runner.call_args_list],
            [["snapshot", "-i"], ["screenshot", screenshot]],
        )

    def test_case_4_session_tab_and_cdp_are_runtime_parameters(self) -> None:
        command_prefix = ["agent-browser"]
        first_tab = build_command("case-4-a", "9222", ["tab", "t-a"], command_prefix)
        second_tab = build_command("case-4-b", None, ["tab", "t-b"], command_prefix)
        self.assertEqual(first_tab, ["agent-browser", "--session", "case-4-a", "--cdp", "9222", "tab", "t-a"])
        self.assertEqual(second_tab, ["agent-browser", "--session", "case-4-b", "tab", "t-b"])
        self.assertNotIn("case-4-a", second_tab)
        self.assertNotIn("--cdp", second_tab)


class BrowserTaskTests(unittest.TestCase):
    def test_normalize_url_only_removes_trailing_slash(self) -> None:
        self.assertEqual(normalize_url("https://chatgpt.com/project/"), "https://chatgpt.com/project")
        self.assertEqual(
            normalize_url("https://chatgpt.com/project/?a=1#chat"),
            "https://chatgpt.com/project/?a=1#chat",
        )

    def test_parse_tab_list_accepts_json_and_ignores_diagnostics(self) -> None:
        output = 'diagnostic [{"id":"t1","url":"https://chatgpt.com"},{"id":"t2","url":"https://example.com"}]'
        self.assertEqual(parse_tab_list(output)[0]["id"], "t1")

    def test_acquire_reuses_exact_url_without_creating_tab(self) -> None:
        calls: list[list[str]] = []

        def runner(args: list[str]) -> str:
            calls.append(args)
            if args[-2:] == ["tab", "list"]:
                return '[{"id":"t7","url":"https://chatgpt.com/project"}]'
            raise AssertionError(args)

        with tempfile.TemporaryDirectory() as temporary:
            result = acquire_task(
                "session-a",
                "9222",
                "https://chatgpt.com/project/",
                False,
                Path(temporary),
                runner,
            )
            self.assertEqual(result["tab_id"], "t7")
            self.assertFalse(result["created"])
            self.assertTrue(Path(result["lease"]).exists())
        self.assertEqual(len(calls), 1)

    def test_acquire_force_new_records_created_tab(self) -> None:
        calls: list[list[str]] = []

        def runner(args: list[str]) -> str:
            calls.append(args)
            if args[-2:] == ["tab", "list"]:
                return '[{"id":"t1","url":"https://chatgpt.com"}]'
            if args[-3:] == ["tab", "new", "https://chatgpt.com/project"]:
                return '{"id":"t8","url":"https://chatgpt.com/project"}'
            raise AssertionError(args)

        with tempfile.TemporaryDirectory() as temporary:
            result = acquire_task(
                "session-a",
                None,
                "https://chatgpt.com/project",
                True,
                Path(temporary),
                runner,
            )
            self.assertEqual(result["tab_id"], "t8")
            self.assertTrue(result["created"])
        self.assertEqual(calls[-1][-3:], ["tab", "new", "https://chatgpt.com/project"])

    def test_acquire_recovers_tab_id_when_tab_new_only_returns_url(self) -> None:
        calls: list[list[str]] = []

        def runner(args: list[str]) -> str:
            calls.append(args)
            if args == ["--json", "tab", "list"]:
                if calls.count(args) == 1:
                    return '[{"id":"t1","url":"https://chatgpt.com"}]'
                return '[{"id":"t1","url":"https://chatgpt.com"},{"id":"t8","url":"https://chatgpt.com/project"}]'
            if args == ["tab", "new", "https://chatgpt.com/project"]:
                return "https://chatgpt.com/project"
            raise AssertionError(args)

        with tempfile.TemporaryDirectory() as temporary:
            result = acquire_task(
                "session-a",
                None,
                "https://chatgpt.com/project",
                True,
                Path(temporary),
                runner,
            )
            self.assertEqual(result["tab_id"], "t8")
            self.assertTrue(result["created"])

    def test_action_saves_before_and_after_snapshots(self) -> None:
        calls: list[list[str]] = []

        def runner(args: list[str]) -> str:
            calls.append(args)
            if args[-2:] == ["tab", "t8"]:
                return ""
            if args[-2:] == ["snapshot", "-i"]:
                return "snapshot output"
            return "action output"

        with tempfile.TemporaryDirectory() as temporary:
            acquired = acquire_task(
                "session-a",
                None,
                "https://chatgpt.com/project",
                True,
                Path(temporary),
                lambda args: '{"id":"t8","url":"https://chatgpt.com/project"}' if args[-3:] == ["tab", "new", "https://chatgpt.com/project"] else "[]",
            )
            result = action_task(acquired["lease"], ["click", "@e123"], runner)
            self.assertEqual(result["returncode"], 0)
            self.assertTrue(Path(result["before_snapshot"]).exists())
            self.assertTrue(Path(result["after_snapshot"]).exists())
            self.assertEqual(calls.count(["tab", "t8"]), 3)

    def test_release_only_closes_created_tab_and_verifies_disappearance(self) -> None:
        calls: list[list[str]] = []

        def runner(args: list[str]) -> str:
            calls.append(args)
            if args[-3:] == ["tab", "close", "t8"]:
                return ""
            if args[-2:] == ["tab", "list"]:
                return '[{"id":"t8","url":"https://chatgpt.com/project"}]' if calls.count(["--json", "tab", "list"]) == 1 else "[]"
            raise AssertionError(args)

        with tempfile.TemporaryDirectory() as temporary:
            lease = Path(temporary) / "lease.json"
            lease.write_text(
                '{"session":"session-a","cdp":null,"url":"https://chatgpt.com/project","tab_id":"t8","created":true}',
                encoding="utf-8",
            )
            result = release_task(str(lease), False, runner)
            self.assertTrue(result["ok"])
            self.assertIn(["tab", "close", "t8"], calls)

    def test_action_keeps_arbitrary_subcommand_but_strips_context_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            lease = Path(temporary) / "lease.json"
            lease.write_text(
                '{"session":"session-a","cdp":null,"url":"https://chatgpt.com/project","tab_id":"t8","created":true}',
                encoding="utf-8",
            )
            calls: list[list[str]] = []

            def runner(args: list[str]) -> str:
                calls.append(args)
                if args == ["snapshot", "-i"]:
                    return "snapshot"
                return ""

            action_task(str(lease), ["--cdp", "9696", "click", "@e123"], runner)
            self.assertIn(["click", "@e123"], calls)

    def test_release_keeps_reused_tab_open(self) -> None:
        def runner(args: list[str]) -> str:
            raise AssertionError(args)

        with tempfile.TemporaryDirectory() as temporary:
            lease = Path(temporary) / "lease.json"
            lease.write_text(
                '{"session":"session-a","cdp":null,"url":"https://chatgpt.com/project","tab_id":"t7","created":false}',
                encoding="utf-8",
            )
            result = release_task(str(lease), False, runner)
            self.assertTrue(result["ok"])
            self.assertFalse(result["closed"])

    def test_status_reports_missing_tab_without_mutation(self) -> None:
        calls: list[list[str]] = []

        def runner(args: list[str]) -> str:
            calls.append(args)
            return "[]"

        with tempfile.TemporaryDirectory() as temporary:
            lease = Path(temporary) / "lease.json"
            lease.write_text(
                '{"session":"session-a","cdp":null,"url":"https://chatgpt.com/project","tab_id":"t9","created":true}',
                encoding="utf-8",
            )
            result = status_task(str(lease), runner)
            self.assertFalse(result["ok"])
            self.assertFalse(result["present"])
        self.assertEqual(calls, [["--json", "tab", "list"]])

    def test_read_only_status_retries_once(self) -> None:
        attempts = 0

        def runner(args: list[str]) -> str:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("transient")
            return '[]'

        with tempfile.TemporaryDirectory() as temporary:
            lease = Path(temporary) / "lease.json"
            lease.write_text(
                '{"session":"session-a","cdp":null,"url":"https://chatgpt.com/project","tab_id":"t9","created":true}',
                encoding="utf-8",
            )
            result = status_task(str(lease), runner)
            self.assertFalse(result["ok"])
        self.assertEqual(attempts, 2)

    def test_action_reports_action_failure_and_still_verifies_after_snapshot(self) -> None:
        calls: list[list[str]] = []

        def runner(args: list[str]) -> Any:
            calls.append(args)
            if args == ["tab", "t8"]:
                return ""
            if args == ["snapshot", "-i"]:
                return "after snapshot"
            return CompletedProcess(args, 7, "", "action failed")

        with tempfile.TemporaryDirectory() as temporary:
            lease = Path(temporary) / "lease.json"
            lease.write_text(
                '{"session":"session-a","cdp":null,"url":"https://chatgpt.com/project","tab_id":"t8","created":true}',
                encoding="utf-8",
            )
            result = action_task(str(lease), ["click", "@e123"], runner)
            self.assertFalse(result["ok"])
            self.assertEqual(result["returncode"], 7)
            self.assertIsNotNone(result["after_snapshot"])
        self.assertIn(["click", "@e123"], calls)


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

    def test_trim_rewrites_merges_and_removes_only_confirmed_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "memory.md"
            for topic, conclusion in (("旧 ref", "复用旧 ref"), ("ref 失效", "旧 ref 会漂移"), ("废弃流程", "使用失效入口")):
                append_entry(path, "1.6.0", topic, "页面变动", conclusion, "实时 snapshot", date(2026, 7, 1))
            result = trim_entries(
                path,
                "1.6.0",
                [
                    {
                        "operation": "merge",
                        "source_indexes": [1, 2],
                        "verified": True,
                        "topic": "ref 实时发现",
                        "scene": "页面更新后",
                        "conclusion": "旧 ref 失效时重新 snapshot 并使用实时控件",
                        "boundary": "不得复用旧 ref",
                    },
                    {"operation": "remove", "source_indexes": [3], "verified": True},
                ],
                date(2026, 8, 2),
            )
            content = path.read_text(encoding="utf-8")
            self.assertEqual(result["entries"], 1)
            self.assertEqual(result["merged"], 1)
            self.assertEqual(result["removed"], 1)
            self.assertIn("## 2026-07-01 — ref 实时发现", content)
            self.assertIn("- 最近核验: 2026-08-02", content)

    def test_trim_refuses_to_remove_unverified_or_omit_an_entry(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "memory.md"
            append_entry(path, "1.6.0", "a", "场景", "结论", "边界", date(2026, 7, 1))
            original = path.read_text(encoding="utf-8")
            with self.assertRaises(ValueError):
                trim_entries(path, "1.6.0", [{"operation": "remove", "source_indexes": [1]}])
            self.assertEqual(path.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
