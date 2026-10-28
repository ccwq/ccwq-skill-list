#!/usr/bin/env python3
"""handoff-portable 脚本的离线回归测试。

只断言外部行为：进程退出码、stdout 状态行、stderr 警告与失败行、落盘文件内容。
不读取脚本内部函数，不触碰真实仓库状态，不需要网络。
"""

import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = ROOT / "skills" / "handoff-portable"
SCRIPT = SKILL_DIR / "scripts" / "portable.py"
POLICY = ROOT / "skills" / "handoff-portable" / "references" / "ste-description.md"
LEGACY = Path(__file__).resolve().parent / "fixtures" / "legacy-handoff.md"
LEGACY_MANIFEST = Path(__file__).resolve().parent / "fixtures" / "legacy-manifest.json"

BASE_MANIFEST = {
    "schema": "handoff-portable/v2",
    "summary": "把登录流程的排障状态交接给普通聊天窗口。",
    "captured_at": "2026-10-28T09:30:00+08:00",
    "coverage": "覆盖本仓库认证模块与其测试；对话历史未穷尽。",
    "skills": [
        {
            "name": "agent-human-debug",
            "source": "skills/agent-human-debug/SKILL.md",
            "status": "当前适用",
            "constraints": "先识别环境，再用最小 probe 采集证据；调试报告必须脱敏。"
        }
    ],
    "global_rules": "输出默认中文；命令、路径与代码保持原文。",
    "project_rules": "测试只断言外部行为；每次改动前先跑单文件测试。",
    "state": {
        "progress": "已完成登录接口的本地复现，未完成跨平台复现。",
        "history": "第一次尝试用完整回溯日志，噪声过大；改为最小 probe 后定位到令牌刷新分支。",
        "verification": "已验证本地 Node 22 下的复现脚本；未验证 macOS 环境。",
        "gaps": "缺少 CI 环境下的令牌刷新日志，暂无法判断是否为环境差异。",
        "next_action": "在 CI 上复现一次，确认是否为环境差异。"
    },
    "materials": []
}


def run_script(script, *args):
    """跑一次指定脚本，返回 CompletedProcess。"""
    return subprocess.run(
        [sys.executable, str(script), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def run(*args):
    """跑一次技能脚本，返回 CompletedProcess。"""
    return run_script(SCRIPT, *args)


def manifest(**overrides):
    """基于基础 manifest 生成一份副本。字典型字段整体替换，不做浅层合并。"""
    data = json.loads(json.dumps(BASE_MANIFEST))
    data.update(overrides)
    return data


def write_manifest(directory, data):
    path = Path(directory) / "manifest.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8", newline="\n")
    return path


def write_text(path, text):
    """以 LF 行尾写入样本，避免 Windows 上默认换行转换影响结构断言。"""
    path.write_text(text, encoding="utf-8", newline="\n")


def build_sample(directory, data=None, name="handoff.md"):
    """写 manifest 并 build，返回 (输出路径, 执行结果)。"""
    path = write_manifest(directory, manifest() if data is None else data)
    output = Path(directory) / name
    return output, run("build", str(path), "--output", str(output))


def reseal(text):
    """重算 footer 校验和，构造结构异常但校验和自洽的样本。"""
    match = re.search(r"<!-- handoff-portable/v2 sha256=[0-9a-f]{64} -->\n?\Z", text)
    assert match, "样本必须带合法的 footer"
    payload = text[:match.start()]
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return payload + f"<!-- handoff-portable/v2 sha256={digest} -->\n"


def section_body(text, tag):
    """取出两个标签之间的正文。"""
    match = re.search(rf"<{tag}>\n\n(.*?)\n\n</{tag}>", text, re.S)
    assert match, f"样本缺少 {tag} 段"
    return match.group(1)


class BuildTests(unittest.TestCase):
    def test_build_writes_all_required_sections(self):
        """
        Given：一份字段齐备的 v2 manifest。
        When：执行 build。
        Then：退出码 0，产出文件含六个必需段落、模式行与接收要求。
        防回归：避免收紧校验时误删既有交接文件的段落。
        """
        with tempfile.TemporaryDirectory() as tmp:
            output, result = build_sample(tmp)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("BUILT:", result.stdout)
            text = output.read_text(encoding="utf-8")
            for tag in ("全局约束", "项目约束", "任务情况", "任务资料", "描述规范", "接收要求"):
                self.assertIn(f"<{tag}>", text)
                self.assertIn(f"</{tag}>", text)
            self.assertIn("模式：`portable`", text)

    def test_build_rejects_invalid_manifest_fields(self):
        """
        Given：schema、时区、state 键集、空串、重名、language 六类畸形输入。
        When：分别执行 build。
        Then：每次都退出 1，stderr 给出 FAILED 与具体原因。
        防回归：避免硬校验在重构中被削弱。
        """
        cases = {
            "schema": (manifest(schema="handoff-portable/v1"), "Unsupported schema"),
            "captured_at": (manifest(captured_at="2026-10-28T09:30:00"), "captured_at requires timezone"),
            "state": (manifest(state={"progress": "x"}), "state fields must match format"),
            "blank": (manifest(summary="   "), "Missing/non-string field: summary"),
            "duplicate": (manifest(skills=[
                {"name": "a", "source": "s", "status": "s", "constraints": "c"},
                {"name": "a", "source": "s", "status": "s", "constraints": "c"},
            ]), "Duplicate skill name"),
            "language": (manifest(materials=[{
                "name": "m", "source": "s", "scope": "sc", "text": "t", "language": "js x"}]),
                "Invalid code language"),
        }
        with tempfile.TemporaryDirectory() as tmp:
            for name, (data, expected) in cases.items():
                with self.subTest(case=name):
                    path = write_manifest(tmp, data)
                    output = Path(tmp) / f"{name}.md"
                    result = run("build", str(path), "--output", str(output))
                    self.assertEqual(result.returncode, 1, result.stdout)
                    self.assertIn("FAILED:", result.stderr)
                    self.assertIn(expected, result.stderr)
                    self.assertFalse(output.exists(), "校验失败时不得产出文件")

    def test_build_reports_existing_output_path(self):
        """
        Given：输出文件已经存在。
        When：执行 build。
        Then：退出 1，stderr 指名该输出路径并说明拒绝覆盖。
        防回归：避免用户拿到一个不知道是哪个文件冲突的报错。
        """
        with tempfile.TemporaryDirectory() as tmp:
            path = write_manifest(tmp, manifest())
            output = Path(tmp) / "handoff.md"
            output.write_text("占位\n", encoding="utf-8")
            result = run("build", str(path), "--output", str(output))
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAILED:", result.stderr)
            self.assertIn(str(output), result.stderr)
            self.assertEqual(output.read_text(encoding="utf-8"), "占位\n")

    def test_build_reports_missing_output_directory(self):
        """
        Given：输出目录不存在。
        When：执行 build。
        Then：退出 1，stderr 指名该输出目录并提示先建目录。
        防回归：避免把「目录不存在」和「文件读不到」混成同一个报错。
        """
        with tempfile.TemporaryDirectory() as tmp:
            path = write_manifest(tmp, manifest())
            output = Path(tmp) / "missing-dir" / "handoff.md"
            result = run("build", str(path), "--output", str(output))
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAILED:", result.stderr)
            self.assertIn(str(output.parent), result.stderr)

    def test_build_reports_missing_manifest(self):
        """
        Given：manifest 文件不存在。
        When：执行 build。
        Then：退出 1，stderr 指名该 manifest 路径。
        防回归：避免调用方需要猜是哪个输入文件出了问题。
        """
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "nope.json"
            result = run("build", str(missing), "--output", str(Path(tmp) / "out.md"))
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAILED:", result.stderr)
            self.assertIn(str(missing), result.stderr)

    def test_build_reports_malformed_json(self):
        """
        Given：manifest 不是合法 JSON。
        When：执行 build。
        Then：退出 1，stderr 指名该 manifest 路径与解析原因。
        防回归：避免多个 manifest 之间无法定位解析失败的那一个。
        """
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "manifest.json"
            path.write_text("{ broken", encoding="utf-8")
            result = run("build", str(path), "--output", str(Path(tmp) / "out.md"))
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAILED:", result.stderr)
            self.assertIn(str(path), result.stderr)

    def test_build_warns_on_semantic_issue_but_still_writes(self):
        """
        Given：portable 模式下技能列表为空。
        When：执行 build。
        Then：退出 0，stderr 给出 WARN，文件照常产出。
        防回归：避免语义体检把本可以先完成的交接整体阻断。
        """
        with tempfile.TemporaryDirectory() as tmp:
            output, result = build_sample(tmp, manifest(skills=[]))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("WARN:", result.stderr)
            self.assertIn("技能列表为空", result.stderr)
            self.assertTrue(output.exists())


class VerifyTests(unittest.TestCase):
    def build_sample(self, tmp):
        """造一份合法交接文件并返回其文本。"""
        output, result = build_sample(tmp)
        self.assertEqual(result.returncode, 0, result.stderr)
        return output.read_text(encoding="utf-8")

    def test_verify_accepts_generated_file(self):
        """
        Given：build 生成的合法交接文件。
        When：执行 verify。
        Then：退出 0，stdout 打印 VERIFIED 且措辞只承诺结构与意外改动检查。
        防回归：避免通过措辞让使用者误以为校验了语义。
        """
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "handoff.md"
            run("build", str(write_manifest(tmp, manifest())), "--output", str(output))
            result = run("verify", str(output))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("VERIFIED:", result.stdout)
            self.assertNotIn("semantic correctness proven", result.stdout)

    def test_verify_rejects_tag_hidden_inside_code_fence(self):
        """
        Given：段落标签只出现在代码围栏内部。
        When：对重算过校验和的文件执行 verify。
        Then：退出 1，报错指向缺失的段落标签而不是校验和不符。
        防回归：避免子串匹配让藏在围栏里的标签蒙混过关。
        """
        with tempfile.TemporaryDirectory() as tmp:
            text = self.build_sample(tmp)
            text = text.replace("<全局约束>\n\n", "```text\n<全局约束>\n\n", 1)
            text = text.replace("\n</全局约束>\n", "\n</全局约束>\n```\n", 1)
            path = Path(tmp) / "handoff.md"
            write_text(path, reseal(text))
            result = run("verify", str(path))
            self.assertEqual(result.returncode, 1)
            self.assertIn("Missing or duplicated section open tag", result.stderr)
            self.assertNotIn("Checksum mismatch", result.stderr)

    def test_verify_rejects_empty_section(self):
        """
        Given：描述规范段落存在但内容为空。
        When：执行 verify。
        Then：退出 1，报错指出空段落。
        防回归：避免空标签被当成有效内容交付。
        """
        with tempfile.TemporaryDirectory() as tmp:
            text = self.build_sample(tmp)
            text = re.sub(r"<描述规范>\n\n.*?\n\n</描述规范>", "<描述规范>\n\n</描述规范>", text, flags=re.S)
            path = Path(tmp) / "handoff.md"
            write_text(path, reseal(text))
            result = run("verify", str(path))
            self.assertEqual(result.returncode, 1)
            self.assertIn("Empty section", result.stderr)

    def test_verify_rejects_out_of_order_sections(self):
        """
        Given：全局约束与项目约束两个段落顺序颠倒。
        When：执行 verify。
        Then：退出 1，报错指出段落顺序错乱。
        防回归：避免接收方按固定顺序跳读时读错段落。
        """
        with tempfile.TemporaryDirectory() as tmp:
            text = self.build_sample(tmp)
            first = re.search(r"<全局约束>.*?</全局约束>\n", text, re.S).group(0)
            second = re.search(r"<项目约束>.*?</项目约束>\n", text, re.S).group(0)
            text = text.replace(first + "\n" + second, second + "\n" + first)
            path = Path(tmp) / "handoff.md"
            write_text(path, reseal(text))
            result = run("verify", str(path))
            self.assertEqual(result.returncode, 1)
            self.assertIn("out of order", result.stderr)

    def test_verify_rejects_unpaired_section(self):
        """
        Given：项目约束段落缺少闭标签。
        When：执行 verify。
        Then：退出 1，报错指出闭标签缺失。
        防回归：避免半截段落被当成完整内容交付。
        """
        with tempfile.TemporaryDirectory() as tmp:
            text = self.build_sample(tmp)
            text = text.replace("</项目约束>\n", "", 1)
            path = Path(tmp) / "handoff.md"
            write_text(path, reseal(text))
            result = run("verify", str(path))
            self.assertEqual(result.returncode, 1)
            self.assertIn("close tag", result.stderr)

    def test_verify_warns_when_portable_has_no_skill(self):
        """
        Given：portable 模式却没有 skill 元素，也没有未确认说明。
        When：执行 verify。
        Then：退出 2，stderr 给出 WARN 而不是 FAILED。
        防回归：避免把「结构合法但内容可疑」与「结构损坏」混为一谈。
        """
        with tempfile.TemporaryDirectory() as tmp:
            text = self.build_sample(tmp)
            text = re.sub(r'<skill name="agent-human-debug">.*?</skill>\n', "", text, flags=re.S)
            text = text.replace("未确认：没有取得已加载技能记录。\n", "")
            path = Path(tmp) / "handoff.md"
            write_text(path, reseal(text))
            result = run("verify", str(path))
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("WARN:", result.stderr)
            self.assertNotIn("FAILED:", result.stderr)

    def test_verify_warns_when_skill_name_mode_has_paired_tag(self):
        """
        Given：模式行是 skill name，文件里却出现成对的 skill 标签。
        When：执行 verify。
        Then：退出 2，stderr 指出模式与标签形态不一致。
        防回归：避免模式与实际产出脱节。
        """
        with tempfile.TemporaryDirectory() as tmp:
            output, _ = build_sample(tmp, manifest(mode="skill name"))
            text = output.read_text(encoding="utf-8")
            text = text.replace(
                '<skill name="agent-human-debug" />',
                '<skill name="agent-human-debug">\n\n约束正文。\n\n</skill>', 1)
            write_text(output, reseal(text))
            result = run("verify", str(output))
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("WARN:", result.stderr)

    def test_verify_rejects_missing_mode_line(self):
        """
        Given：文件缺少模式行。
        When：执行 verify。
        Then：退出 1，报错指出模式行缺失。
        防回归：避免接收方无法判断交接文件的携带方式。
        """
        with tempfile.TemporaryDirectory() as tmp:
            text = self.build_sample(tmp)
            text = text.replace("模式：`portable`\n", "", 1)
            path = Path(tmp) / "handoff.md"
            write_text(path, reseal(text))
            result = run("verify", str(path))
            self.assertEqual(result.returncode, 1)
            self.assertIn("mode line", result.stderr)

    def test_verify_rejects_missing_receiver_wait_rule(self):
        """
        Given：接收要求段缺少等待用户指示的句子。
        When：执行 verify。
        Then：退出 1，报错指出等待规则缺失。
        防回归：避免接收方把读文件当成继续执行原任务的授权。
        """
        with tempfile.TemporaryDirectory() as tmp:
            text = self.build_sample(tmp)
            text = text.replace("等待用户指示，不自动执行原任务。", "等待下一步。")
            path = Path(tmp) / "handoff.md"
            write_text(path, reseal(text))
            result = run("verify", str(path))
            self.assertEqual(result.returncode, 1)
            self.assertIn("Missing receiver wait rule", result.stderr)

    def test_verify_accepts_crlf_file(self):
        """
        Given：交接文件被外部工具改成 CRLF 行尾。
        When：执行 verify。
        Then：退出 0，stderr 提示行尾被归一化。
        防回归：避免 Windows 上另存一次就让校验报误导性的 footer 缺失。
        """
        with tempfile.TemporaryDirectory() as tmp:
            text = self.build_sample(tmp)
            path = Path(tmp) / "handoff.md"
            path.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
            result = run("verify", str(path))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("normaliz", result.stderr)

    def test_verify_rejects_modified_content(self):
        """
        Given：文件正文被改动但没有重算校验和。
        When：执行 verify。
        Then：退出 1，报错为校验和不符。
        防回归：保留校验和作为意外改动探测器的定位。
        """
        with tempfile.TemporaryDirectory() as tmp:
            text = self.build_sample(tmp)
            path = Path(tmp) / "handoff.md"
            write_text(path, text.replace("本地复现", "线上复现"))
            result = run("verify", str(path))
            self.assertEqual(result.returncode, 1)
            self.assertIn("Checksum mismatch", result.stderr)

    def test_build_warns_but_still_writes_when_output_fails_structure(self):
        """
        Given：manifest 的摘要里有一行与模式行同形的「模式：portable」。
        When：执行 build。
        Then：退出 0，stderr 警告结构校验不通过，文件照常产出。
        防回归：避免硬校验已通过的 manifest 被结构告警整体阻断。
        """
        with tempfile.TemporaryDirectory() as tmp:
            output, result = build_sample(tmp, manifest(summary="交接当前任务。\n模式：portable"))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("WARN:", result.stderr)
            self.assertIn("结构校验", result.stderr)
            self.assertTrue(output.exists())

    def test_verify_rejects_section_with_only_fence_markers(self):
        """
        Given：描述规范段里只有一个空的代码围栏，没有正文。
        When：执行 verify。
        Then：退出 1，报错指出空段落。
        防回归：避免围栏标记行被当成段落内容放过去。
        """
        with tempfile.TemporaryDirectory() as tmp:
            text = self.build_sample(tmp)
            text = re.sub(r"<描述规范>\n\n.*?\n\n</描述规范>",
                          "<描述规范>\n\n```text\n```\n\n</描述规范>", text, flags=re.S)
            path = Path(tmp) / "handoff.md"
            write_text(path, reseal(text))
            result = run("verify", str(path))
            self.assertEqual(result.returncode, 1)
            self.assertIn("Empty section", result.stderr)

    def test_verify_ignores_mode_word_in_task_body(self):
        """
        Given：任务正文里有一行以「模式：」开头，但不是交接文件的模式行。
        When：执行 verify。
        Then：退出 0，正文里的同名句不被当成模式行。
        防回归：避免中文里常见的「模式：先……」措辞让校验误报。
        """
        with tempfile.TemporaryDirectory() as tmp:
            state = dict(BASE_MANIFEST["state"], next_action="模式：先跑单文件测试。")
            data = manifest(state=state)
            output, result = build_sample(tmp, data)
            self.assertEqual(result.returncode, 0, result.stderr)
            verify = run("verify", str(output))
            self.assertEqual(verify.returncode, 0, verify.stderr)

    def test_build_output_matches_pre_hardening_bytes(self):
        """
        Given：加固前生成的交接文件样本及其对应 manifest。
        When：用加固后的脚本重新构建同一份 manifest。
        Then：产出的字节与样本完全一致。
        防回归：避免校验收紧时顺带改动了交接文件的产出格式。
        """
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "handoff.md"
            result = run("build", str(LEGACY_MANIFEST), "--output", str(output))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output.read_bytes(), LEGACY.read_bytes())

    def test_verify_accepts_legacy_file(self):
        """
        Given：本次收紧前生成的合法交接文件。
        When：执行 verify。
        Then：退出 0。
        防回归：避免校验收紧作废既有交接文件。
        """
        result = run("verify", str(LEGACY))
        self.assertEqual(result.returncode, 0, result.stderr)


class CheckTests(unittest.TestCase):
    def test_check_reports_no_warning_for_clean_manifest(self):
        """
        Given：一份没有语义可疑点的 manifest。
        When：执行 check。
        Then：退出 0，stderr 没有 WARN。
        防回归：避免体检变成无意义的噪音源。
        """
        with tempfile.TemporaryDirectory() as tmp:
            path = write_manifest(tmp, manifest())
            result = run("check", str(path))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("WARN:", result.stderr)
            self.assertIn("CHECKED:", result.stdout)

    def test_check_warns_on_empty_skill_list(self):
        """
        Given：portable 模式但技能列表为空。
        When：执行 check。
        Then：退出 2，WARN 指出技能列表为空。
        防回归：避免交接文件缺全部技能约束却无人察觉。
        """
        with tempfile.TemporaryDirectory() as tmp:
            path = write_manifest(tmp, manifest(skills=[]))
            result = run("check", str(path))
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("技能列表为空", result.stderr)

    def test_check_warns_on_dropped_constraints(self):
        """
        Given：skill name 模式的条目仍带着 constraints 正文。
        When：执行 check。
        Then：退出 2，WARN 指出该正文会被丢弃并定位到技能名。
        防回归：避免调用方以为约束正文已经带进交接文件。
        """
        with tempfile.TemporaryDirectory() as tmp:
            path = write_manifest(tmp, manifest(mode="skill name"))
            result = run("check", str(path))
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("skill name", result.stderr)
            self.assertIn("agent-human-debug", result.stderr)

    def test_check_warns_on_scope_mismatch(self):
        """
        Given：资料声明范围是完整正文，实际正文远短于源文件。
        When：执行 check。
        Then：退出 2，WARN 指出是哪份资料、长度差多少。
        防回归：避免把节选当全文交付。
        """
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "big.txt"
            source.write_text("x" * 6000, encoding="utf-8")
            path = write_manifest(tmp, manifest(
                captured_at="2099-01-01T00:00:00+08:00",
                materials=[{
                    "name": "大文件", "source": str(source), "scope": "完整正文",
                    "text": "只有开头一行。"}]))
            result = run("check", str(path))
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("大文件", result.stderr)
            self.assertIn("明显短于源文件", result.stderr)

    def test_check_warns_when_source_is_newer_than_capture(self):
        """
        Given：资料源文件的修改时间晚于采集时间。
        When：执行 check。
        Then：退出 2，WARN 指出资料与时间差。
        防回归：避免交接文件带着过期资料却标成最新。
        """
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "later.txt"
            source.write_text("较新的内容\n", encoding="utf-8")
            path = write_manifest(tmp, manifest(
                captured_at="2020-01-01T00:00:00+08:00",
                materials=[{
                    "name": "过期资料", "source": str(source), "scope": "摘录",
                    "text": "较新的内容\n"}]))
            result = run("check", str(path))
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("过期资料", result.stderr)
            self.assertIn("修改时间晚于采集时间", result.stderr)

    def test_check_warns_on_suspected_credential(self):
        """
        Given：资料正文里出现疑似凭据。
        When：执行 check。
        Then：退出 2，WARN 要求人工复核并定位资料。
        防回归：避免未脱敏的凭据随交接文件外发。
        """
        with tempfile.TemporaryDirectory() as tmp:
            path = write_manifest(tmp, manifest(materials=[{
                "name": "配置样例", "source": "示例来源", "scope": "摘录",
                "text": "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"}]))
            result = run("check", str(path))
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("配置样例", result.stderr)
            self.assertIn("人工复核", result.stderr)

    def test_check_resolves_source_relative_to_manifest(self):
        """
        Given：资料来源写的是相对文件名，源文件与 manifest 同目录。
        When：执行 check。
        Then：退出 2，WARN 指出正文明显短于源文件。
        防回归：避免相对路径的来源被当成不可达而漏检。
        """
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "src.md"
            source.write_text("x" * 3000, encoding="utf-8")
            path = write_manifest(tmp, manifest(
                captured_at="2099-01-01T00:00:00+08:00",
                materials=[{
                    "name": "相对路径资料", "source": "src.md", "scope": "完整正文",
                    "text": "短"}]))
            result = run("check", str(path))
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("相对路径资料", result.stderr)
            self.assertIn("明显短于源文件", result.stderr)

    def test_check_skips_unreachable_source(self):
        """
        Given：资料来源路径在本机不存在。
        When：执行 check。
        Then：退出 0，不产生长度与时间类警告。
        防回归：避免不可达的来源制造无法处理的噪音。
        """
        with tempfile.TemporaryDirectory() as tmp:
            path = write_manifest(tmp, manifest(materials=[{
                "name": "外部资料", "source": "docs/not-here-8f21.md", "scope": "完整正文",
                "text": "少量摘录。"}]))
            result = run("check", str(path))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("WARN:", result.stderr)

    def test_check_fails_on_invalid_manifest(self):
        """
        Given：manifest 的硬校验不通过。
        When：执行 check。
        Then：退出 1，报错为 FAILED。
        防回归：避免体检跳过输入校验，输出没有意义的警告。
        """
        with tempfile.TemporaryDirectory() as tmp:
            path = write_manifest(tmp, manifest(schema="handoff-portable/v1"))
            result = run("check", str(path))
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAILED:", result.stderr)


class PolicyTests(unittest.TestCase):
    def test_description_section_uses_anchored_policy_body(self):
        """
        Given：STE 规范文件用显式标记圈定正文。
        When：build 出一份交接文件。
        Then：描述规范段的内容精确等于标记之间的正文，且不含标记与标记外的说明段。
        防回归：避免改说明段就把无关文字带进交接文件。
        """
        policy = POLICY.read_text(encoding="utf-8")
        start = policy.index("<!-- ste-policy:start -->") + len("<!-- ste-policy:start -->")
        end = policy.index("<!-- ste-policy:end -->")
        expected = policy[start:end].strip()
        with tempfile.TemporaryDirectory() as tmp:
            output, result = build_sample(tmp)
            self.assertEqual(result.returncode, 0, result.stderr)
            text = output.read_text(encoding="utf-8")
            body = section_body(text, "描述规范")
            self.assertEqual(body, expected)
            self.assertNotIn("ste-policy", body)
            self.assertNotIn("将下面正文内嵌到交接文件", body)

    def test_build_fails_when_policy_anchors_missing(self):
        """
        Given：技能目录里的 STE 规范文件缺少锚点标记。
        When：执行 build。
        Then：退出 1，报错点名该规范文件与缺失的标记。
        防回归：避免规范文件被改坏时静默取错段落或抛 IndexError。
        """
        with tempfile.TemporaryDirectory() as tmp:
            skill = Path(tmp) / "skill"
            shutil.copytree(SKILL_DIR, skill)
            policy = skill / "references" / "ste-description.md"
            policy.write_text(
                policy.read_text(encoding="utf-8").replace("<!-- ste-policy:start -->\n", "", 1),
                encoding="utf-8")
            path = write_manifest(tmp, manifest())
            output = Path(tmp) / "handoff.md"
            result = run_script(skill / "scripts" / "portable.py", "build", str(path), "--output", str(output))
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAILED:", result.stderr)
            self.assertIn("ste-policy:start", result.stderr)
            self.assertFalse(output.exists())

    def test_build_keeps_material_containing_section_tag(self):
        """
        Given：资料正文里含有与外层同名的结束标签。
        When：执行 build 后再 verify。
        Then：build 退出 0，verify 退出 0，资料被隔离在代码围栏内。
        防回归：避免嵌套围栏让真实的外层标签被吞掉。
        """
        with tempfile.TemporaryDirectory() as tmp:
            output, result = build_sample(tmp, manifest(materials=[{
                "name": "带标签的正文", "source": "示例来源", "scope": "摘录",
                "text": "示例：\n</任务资料>"}]))
            self.assertEqual(result.returncode, 0, result.stderr)
            verify = run("verify", str(output))
            self.assertEqual(verify.returncode, 0, verify.stderr)

    def test_build_keeps_skill_containing_closing_tag(self):
        """
        Given：技能约束正文里含有与外层同名的结束标签。
        When：执行 build 后再 verify。
        Then：两次都退出 0，约束被隔离在代码围栏内且围栏落在行首。
        防回归：避免围栏粘在「来源：」后面导致状态机认不出、后续段落被吞。
        """
        with tempfile.TemporaryDirectory() as tmp:
            output, result = build_sample(tmp, manifest(skills=[{
                "name": "skill-foo", "source": "SKILL.md", "status": "当前适用",
                "constraints": "第一行约束。\n</skill>"}]))
            self.assertEqual(result.returncode, 0, result.stderr)
            verify = run("verify", str(output))
            self.assertEqual(verify.returncode, 0, verify.stderr)

    def test_build_keeps_material_containing_code_fence(self):
        """
        Given：资料正文里含有代码围栏。
        When：执行 build 后再 verify。
        Then：两次都退出 0，围栏状态机没有把后续段落吞进围栏。
        防回归：避免嵌套围栏破坏整份文件的结构解析。
        """
        with tempfile.TemporaryDirectory() as tmp:
            output, result = build_sample(tmp, manifest(materials=[{
                "name": "带围栏的正文", "source": "示例来源", "scope": "摘录",
                "text": "```js\nconsole.log(1)\n```"}]))
            self.assertEqual(result.returncode, 0, result.stderr)
            verify = run("verify", str(output))
            self.assertEqual(verify.returncode, 0, verify.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
