"""subagent-router V2 静态回归测试：仅使用 Python 标准库。"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = ROOT / "skills" / "subagent-router"
SKILL = SKILL_DIR / "SKILL.md"
REFERENCES = {
    "routing": SKILL_DIR / "references" / "routing-policy.md",
    "grilling": SKILL_DIR / "references" / "grilling-protocol.md",
    "external": SKILL_DIR / "references" / "external-exec-policy.md",
    "worker": SKILL_DIR / "references" / "worker-contract.md",
    "failure": SKILL_DIR / "references" / "failure-policy.md",
}
SCRIPTS = {
    "route": SKILL_DIR / "scripts" / "route-decision.mjs",
    "contract": SKILL_DIR / "scripts" / "validate-worker-contract.mjs",
    "verify": SKILL_DIR / "scripts" / "verify-router-skill.mjs",
}


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def json_fences(markdown: str) -> list[str]:
    return re.findall(r"```json\s*\n(.*?)```", markdown, flags=re.DOTALL | re.IGNORECASE)


class SubagentRouterStaticTests(unittest.TestCase):
    """验证 V2 契约语义；刻意不把自然语言措辞固定为精确全文。"""

    def setUp(self) -> None:
        self.skill = read(SKILL)
        self.references = {name: read(path) for name, path in REFERENCES.items() if path.exists()}
        self.corpus = "\n".join([self.skill, *self.references.values()])

    def run_first_success(self, candidates: list[list[str]]) -> subprocess.CompletedProcess[str]:
        """兼容命名参数与维护者说明的等价位置参数形式。"""
        results = [subprocess.run(command, cwd=ROOT, text=True, capture_output=True) for command in candidates]
        for result in results:
            if result.returncode == 0:
                return result
        details = "\n".join(f"{result.args}: {result.stderr}" for result in results)
        self.fail(f"all equivalent CLI forms failed:\n{details}")

    # Given：V2 Skill 由核心文档和五个职责明确的引用文件组成
    # When：检查实现文件是否已完整落盘
    # Then：每个被 Spec 7.1 要求的引用均可读取
    # 防回归：避免主文档引用不存在，导致运行时无法获得路由、授权和失败规则
    def test_required_skill_files_exist(self) -> None:
        self.assertTrue(SKILL.is_file(), SKILL)
        for name, path in REFERENCES.items():
            self.assertTrue(path.is_file(), f"missing {name}: {path}")

    # Given：Skill 的 YAML frontmatter 是加载入口
    # When：以基础 YAML 结构校验开始和结束分隔符及必填键
    # Then：name 与 description 均存在且非空
    # 防回归：避免 Markdown 正文完整但 Skill 无法被宿主识别
    def test_frontmatter_has_basic_yaml_shape(self) -> None:
        match = re.match(r"^---\s*\n(.*?)\n---\s*\n", self.skill, flags=re.DOTALL)
        self.assertIsNotNone(match, "SKILL.md must start with YAML frontmatter")
        fields = dict(re.findall(r"^([A-Za-z][\w-]*):\s*(.+?)\s*$", match.group(1), flags=re.MULTILINE))
        self.assertTrue(fields.get("name"))
        self.assertTrue(fields.get("description"))

    # Given：Spec 7.1 要求 Native-first / External fallback 与双门禁保持一致
    # When：检查核心和引用语料中的后端、能力、状态和授权语义
    # Then：原生默认、外部兼容、运行时能力判定及两个精确口令都可追溯
    # 防回归：避免回退到假定 Luna 可原生 spawn 或旧的单门禁流程
    def test_native_first_capability_and_dual_gate_contract(self) -> None:
        for token in ("native_spawn", "external_exec", "native_supported", "native_unsupported", "已达成共同理解", "授权执行"):
            self.assertIn(token, self.corpus)
        self.assertRegex(self.corpus, r"(?is)native_supported.{0,160}(must use|必须使用).{0,80}native_spawn|native_spawn.{0,160}(默认|优先|first)")
        self.assertRegex(self.corpus, r"(?is)external_exec.{0,180}(compatib|fallback|兼容|回退)|(compatib|fallback|兼容|回退).{0,180}external_exec")
        self.assertLess(self.corpus.index("已达成共同理解"), self.corpus.index("授权执行"))
        self.assertRegex(self.corpus, r"(?is)(运行时|当前会话|runtime|current.session).{0,180}(能力|Schema|Available models|capability)")
        self.assertNotRegex(self.corpus, r"(?is)直接.{0,80}假定.{0,80}Luna.{0,80}(native_spawn|spawn)")

    # Given：执行授权前只能讨论、分析和只读核验
    # When：检查授权边界与旧口令迁移声明
    # Then：未获授权执行不得创建 Worker、写入或启动外部进程，确认分发不被定义为执行口令
    # 防回归：避免把讨论确认误当成有副作用的执行许可
    def test_authorization_boundary_and_legacy_phrase(self) -> None:
        self.assertRegex(self.corpus, r"(?is)未获.{0,40}授权执行.{0,260}(禁止|不得).{0,260}(Worker|写入|worktree|external_exec|外部进程)|before.{0,80}(second phrase|授权执行).{0,260}(do not|must not).{0,260}(Worker|modify files|worktree|codex exec|external state)")
        if "确认分发" in self.corpus:
            self.assertRegex(self.corpus, r"(?is)确认分发.{0,100}(不是|不再|无效).{0,100}(执行|口令|授权)|(不是|不再|无效).{0,100}确认分发|do not accept.{0,100}确认分发")

    # Given：外部写入比原生调用更需要工作区隔离和失败可审计性
    # When：检查外部策略、并发重试、失败分类及静默替换禁令
    # Then：隔离目录、写入互斥、一次技术重试和四类失败均有明确契约
    # 防回归：避免外部 Worker 覆盖共享工作区或失败后悄然改变路由语义
    def test_isolation_failure_and_no_silent_substitution_contract(self) -> None:
        for token in ("external_exec", "worktree", "writable directory", "Technical", "Capability", "Semantic", "boundary", "Provider", "context", "workspace"):
            self.assertIn(token, self.corpus)
        self.assertRegex(self.corpus, r"(?is)(技术.{0,120}重试.{0,60}(一次|1)|Technical.{0,180}Retry once)")
        self.assertRegex(self.corpus, r"(?is)(不得|禁止).{0,100}静默.{0,160}(模型|Provider|后端)|Never silently.{0,160}(model|Provider|backend)")

    # Given：Worker 输入与结果必须是可机器审查的 JSON 契约
    # When：检查 worker-contract 引用和所有 JSON 代码块
    # Then：核心身份、范围、证据、验证字段存在，且每个示例可由 json.loads 解析
    # 防回归：避免文档示例失效或 Worker 返回无法由主线程独立验收
    def test_worker_contract_fields_and_json_examples(self) -> None:
        worker = self.references["worker"]
        for token in ("task_id", "backend", "model", "context_level", "workspace", "allowed_scope", "status", "evidence", "validation", "unresolved"):
            self.assertIn(token, worker)
        sources = [SKILL, *REFERENCES.values()]
        examples = [block for source in sources if source.exists() for block in json_fences(read(source))]
        self.assertGreater(len(examples), 0, "expected JSON contract examples")
        for example in examples:
            json.loads(example)

    # Given：Skill 和 references 使用相对 Markdown 链接组织规范
    # When：解析本 Skill 目录下 Markdown 文件中的相对链接
    # Then：每一个本地目标均存在
    # 防回归：避免规范拆分后出现断链，违反 Spec 7.1 的引用有效性要求
    def test_relative_markdown_links_resolve(self) -> None:
        markdown_files = [SKILL, *REFERENCES.values()]
        for source in markdown_files:
            for target in re.findall(r"(?<!!)\[[^]]*\]\(([^)#]+)(?:#[^)]*)?\)", read(source)):
                if re.match(r"[a-z]+://", target, flags=re.IGNORECASE) or target.startswith("mailto:"):
                    continue
                self.assertTrue((source.parent / target).resolve().exists(), f"{source}: {target}")

    # Given：G1 交付了三个确定性的 Node 辅助脚本
    # When：对每个脚本执行 --help，并向其传入缺失参数
    # Then：帮助调用成功且非法调用以非零状态 fail-closed
    # 防回归：避免脚本存在但 CLI 入口失效，或错误输入被误判为可执行路由
    def test_helper_scripts_have_help_and_fail_closed_cli(self) -> None:
        for name, script in SCRIPTS.items():
            self.assertTrue(script.is_file(), f"missing {name} helper: {script}")
            help_result = subprocess.run(["node", str(script), "--help"], cwd=ROOT, text=True, capture_output=True)
            self.assertEqual(help_result.returncode, 0, help_result.stderr)
        for name in ("route", "contract"):
            script = SCRIPTS[name]
            invalid_result = subprocess.run(["node", str(script), "--not-a-real-option"], cwd=ROOT, text=True, capture_output=True)
            self.assertNotEqual(invalid_result.returncode, 0, f"{name} accepted an unknown option")

    # Given：路由和 Worker 校验脚本需要处理确定性的 JSON 输入
    # When：提供无法解析的 JSON 文件给各自的输入入口
    # Then：命令失败且不会把坏输入输出为有效决策或契约
    # 防回归：避免调用方因输入损坏而获得错误的可执行授权结论
    def test_json_input_helpers_reject_malformed_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            bad_input = Path(temp_dir) / "bad.json"
            bad_input.write_text("{not json", encoding="utf-8")
            commands = [
                ["node", str(SCRIPTS["route"]), "--input", str(bad_input)],
                ["node", str(SCRIPTS["contract"]), "--kind", "input", "--type", "research", "--input", str(bad_input)],
                ["node", str(SCRIPTS["contract"]), "--kind", "input", str(bad_input)],
            ]
            for command in commands:
                result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
                self.assertNotEqual(result.returncode, 0, f"malformed JSON unexpectedly accepted: {command[1]}")

    # Given：运行时能力与授权条件已经完整提供给确定性路由脚本
    # When：传入 native_supported、read 与 execution_authorized 的最小输入
    # Then：输出可解析 JSON，且决策为 native_spawn 与可执行
    # 防回归：避免原生已支持时错误回退 external_exec 或在未授权状态误执行
    def test_route_helper_selects_native_backend_for_authorized_native_capability(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "native.json"
            input_path.write_text(json.dumps({"capability": "native_supported", "permission": "read", "execution_authorized": True}), encoding="utf-8")
            result = subprocess.run(
                ["node", str(SCRIPTS["route"]), "--input", str(input_path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            decision = json.loads(result.stdout)
            self.assertEqual(decision.get("backend"), "native_spawn")
            self.assertTrue(decision.get("executable"))
            self.assertFalse(decision.get("authorization_required"))

    # Given：research Worker 的最小输入满足 V2 Worker 输入契约
    # When：通过辅助脚本按 input/research 校验 JSON 文件
    # Then：校验命令成功并输出可解析的成功语义
    # 防回归：避免字段校验脚本与文档中的 Worker 输入契约发生漂移
    def test_contract_helper_accepts_complete_research_input(self) -> None:
        payload = {
            "task_id": "t1", "goal": "bounded research", "backend": "native_spawn", "model": "model",
            "provider_profile": "inherited", "reasoning_effort": "medium", "context_level": "minimal",
            "workspace": "workspace", "allowed_scope": ["src"], "forbidden_actions": ["write"],
            "known_facts": ["fact"], "output_contract": "research", "acceptance_criteria": ["evidence"],
            "failure_contract": "return blockers",
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "worker.json"
            input_path.write_text(json.dumps(payload), encoding="utf-8")
            result = self.run_first_success([
                ["node", str(SCRIPTS["contract"]), "--kind", "input", "--type", "research", "--input", str(input_path)],
                ["node", str(SCRIPTS["contract"]), "--kind", "input", str(input_path)],
            ])
            if result.stdout.strip():
                try:
                    output = json.loads(result.stdout)
                except json.JSONDecodeError:
                    self.assertRegex(result.stdout, r"(?i)valid|success")
                else:
                    self.assertTrue(output.get("valid", output.get("ok", True)))

    # Given：completed 结果缺少可验收证据和验证记录，且已报告边界违规
    # When：以 research result 类型交给确定性契约校验器
    # Then：校验器必须以非零状态拒绝该结果
    # 防回归：避免 Worker 仅声明 completed 就绕过主线程的证据、验证和边界审查
    def test_contract_helper_rejects_completed_result_without_evidence_or_validation(self) -> None:
        payload = {
            "status": "completed", "task_id": "t1", "backend": "native_spawn", "model": "model",
            "provider_profile": "inherited", "reasoning_effort": "medium", "context_level": "minimal",
            "workspace": "workspace", "scope_observed": ["src"], "summary": "claimed completion",
            "evidence": [], "validation": [], "boundary_violations": ["unowned write"], "unresolved": [],
            "findings": [], "confidence": "high", "unknowns": [],
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "invalid-completed.json"
            input_path.write_text(json.dumps(payload), encoding="utf-8")
            result = subprocess.run(
                ["node", str(SCRIPTS["contract"]), "--kind", "result", "--type", "research", str(input_path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0, "invalid completed result was accepted")

    # Given：batch 结果需要让每一个子项都能被独立验收
    # When：提供缺少 status 的 batch item 给确定性契约校验器
    # Then：校验器必须 fail-closed，不得把批次总状态当成子项成功
    # 防回归：避免总体成功掩盖无状态或未验收的批量子项
    def test_contract_helper_rejects_batch_item_without_status(self) -> None:
        payload = {
            "status": "completed", "task_id": "batch-1", "backend": "native_spawn", "model": "model",
            "provider_profile": "inherited", "reasoning_effort": "medium", "context_level": "minimal",
            "workspace": "workspace", "scope_observed": ["src"], "summary": "batch completion",
            "evidence": ["report"], "validation": ["schema check"], "boundary_violations": [], "unresolved": [],
            "item_results": [{"task_id": "item-1"}], "failed_items": [], "summary_statistics": {},
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "invalid-batch.json"
            input_path.write_text(json.dumps(payload), encoding="utf-8")
            result = subprocess.run(
                ["node", str(SCRIPTS["contract"]), "--kind", "result", "--type", "batch", str(input_path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0, "batch item without status was accepted")


if __name__ == "__main__":
    unittest.main(verbosity=2)
