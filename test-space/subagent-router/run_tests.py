"""subagent-router V3 确定性回归测试：仅使用 Python 标准库。"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = ROOT / "skills" / "subagent-router"
SKILL = SKILL_DIR / "SKILL.md"
REFERENCES = {
    "routing": SKILL_DIR / "references" / "routing-policy.md",
    "grilling": SKILL_DIR / "references" / "grilling-protocol.md",
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
    return re.findall(r"~~~json\s*\n(.*?)~~~", markdown, flags=re.DOTALL | re.IGNORECASE)


class SubagentRouterV3Tests(unittest.TestCase):
    """验证原生嵌套、一次授权与 Worker 契约。"""

    def setUp(self) -> None:
        self.skill = read(SKILL)
        self.references = {name: read(path) for name, path in REFERENCES.items()}
        self.corpus = "\n".join([self.skill, *self.references.values()])

    def run_json(self, script: Path, payload: dict, *args: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "input.json"
            input_path.write_text(json.dumps(payload), encoding="utf-8")
            return subprocess.run(
                ["node", str(script), *args, str(input_path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
            )

    def route_payload(self) -> dict:
        return {
            "parent_model": "terra",
            "requested_model": "sol",
            "authorization_message": "okok",
            "current_depth": 0,
            "workers_created": 0,
            "active_workers": 0,
            "delegation": {
                "enabled": True,
                "allowed_child_models": ["luna", "terra", "sol"],
                "max_depth": 2,
                "max_workers": 5,
                "max_concurrency": 2,
            },
        }

    def luna_leaf_payload(self) -> dict:
        return {
            "task_id": "leaf-luna",
            "goal": "bounded research",
            "parent_model": "terra",
            "model": "luna",
            "reasoning_effort": "low",
            "spawn_depth": 1,
            "permission": "read",
            "context_level": "minimal",
            "workspace": "workspace",
            "allowed_scope": ["src"],
            "forbidden_actions": ["write"],
            "known_facts": ["fact"],
            "delegation": {
                "enabled": False,
                "allowed_child_models": [],
                "max_depth": 2,
                "max_workers": 5,
                "max_concurrency": 2,
            },
            "output_contract": "research",
            "acceptance_criteria": ["evidence"],
            "failure_contract": "return blockers",
        }

    #
    # Given：V3 Skill 由原生路由、一次授权和 Worker 契约引用组成
    # When：检查实现文件和已移除的旧兼容策略
    # Then：V3 所需文件存在且 external-exec-policy.md 不存在
    # 防回归：避免删除旧 fallback 后留下断链或死策略文件
    # /
    def test_required_v3_files_exist_and_external_policy_is_removed(self) -> None:
        self.assertTrue(SKILL.is_file())
        for path in [*REFERENCES.values(), *SCRIPTS.values()]:
            self.assertTrue(path.is_file(), path)
        self.assertFalse((SKILL_DIR / "references" / "external-exec-policy.md").exists())

    #
    # Given：授权协议已从双门禁改成独立精确 okok
    # When：读取 Skill 和协议引用
    # Then：语料包含新协议并清除旧授权和兼容状态机术语
    # 防回归：避免旧文档继续诱导 Agent 等待两次确认或使用外部进程
    # /
    def test_v3_corpus_has_one_okok_gate_and_no_legacy_semantics(self) -> None:
        for token in ("okok", "delegation envelope", "Luna", "Terra", "Sol", "native_spawn"):
            self.assertIn(token, self.corpus)
        for obsolete in ("external_exec", "native_supported", "native_unsupported", "授权执行", "已达成共同理解"):
            self.assertNotIn(obsolete, self.corpus)
        self.assertRegex(self.skill, r"(?is)removing leading and trailing whitespace.{0,120}exactly equal lowercase okok")

    #
    # Given：Skill 的 YAML frontmatter 是宿主加载入口
    # When：校验 frontmatter 边界和必填键
    # Then：name 与 description 均存在且非空
    # 防回归：避免协议正确但 Skill 无法被宿主识别
    # /
    def test_frontmatter_has_basic_yaml_shape(self) -> None:
        match = re.match(r"^---\s*\n(.*?)\n---\s*\n", self.skill, flags=re.DOTALL)
        self.assertIsNotNone(match)
        fields = dict(re.findall(r"^([A-Za-z][\w-]*):\s*(.+?)\s*$", match.group(1), flags=re.MULTILINE))
        self.assertEqual(fields.get("name"), "subagent-router")
        self.assertTrue(fields.get("description"))

    #
    # Given：Terra/Sol 在授权派生额度内允许继续嵌套
    # When：Terra 请求创建 Sol，且输入含精确 okok 和可用额度
    # Then：确定性路由器只返回 native_spawn 且允许执行
    # 防回归：避免 V3 把 Terra/Sol 人为扁平化
    # /
    def test_route_allows_terra_or_sol_nesting_inside_envelope(self) -> None:
        result = self.run_json(SCRIPTS["route"], self.route_payload(), "--input")
        self.assertEqual(result.returncode, 0, result.stderr)
        decision = json.loads(result.stdout)
        self.assertTrue(decision["executable"])
        self.assertEqual(decision["backend"], "native_spawn")
        self.assertEqual(decision["child_depth"], 1)

    #
    # Given：Luna 可以成为 Worker 但不能派生任何子智能体
    # When：Luna 作为父模型请求创建 Terra 子 Worker
    # Then：路由器拒绝执行并解释 Luna 限制
    # 防回归：避免 Codex 更新后误把 Luna 的可使用性理解为可继续派生
    # /
    def test_route_rejects_any_luna_parent_spawn(self) -> None:
        payload = self.route_payload()
        payload["parent_model"] = "luna"
        result = self.run_json(SCRIPTS["route"], payload, "--input")
        self.assertEqual(result.returncode, 0, result.stderr)
        decision = json.loads(result.stdout)
        self.assertFalse(decision["executable"])
        self.assertIn("Luna cannot create", decision["reason"])

    #
    # Given：一次授权仅接受独立且规范化后精确等于 okok 的消息
    # When：分别传入正确大小写、附带文本和仅首尾空白不同的授权消息
    # Then：只有规范化后精确等于 okok 的输入可以进入派生决策
    # 防回归：避免引用、长句或大小写变体意外触发执行
    # /
    def test_route_requires_exact_normalized_okok(self) -> None:
        allowed = self.route_payload()
        allowed["authorization_message"] = "  okok  "
        result = self.run_json(SCRIPTS["route"], allowed, "--input")
        self.assertTrue(json.loads(result.stdout)["executable"])
        for message in ("OKOK", "okok please", "", "please okok"):
            payload = self.route_payload()
            payload["authorization_message"] = message
            result = self.run_json(SCRIPTS["route"], payload, "--input")
            self.assertEqual(result.returncode, 0, result.stderr)
            decision = json.loads(result.stdout)
            self.assertFalse(decision["executable"])
            self.assertTrue(decision["authorization_required"])

    #
    # Given：深度、数量、模型列表和并发均是用户批准的派生额度
    # When：分别超出这些额度或关闭派生开关
    # Then：路由器拒绝当前请求并标记需要修订预览
    # 防回归：避免一次 okok 被扩张为未预览的无限团队树
    # /
    def test_route_rejects_requests_outside_delegation_envelope(self) -> None:
        variants = [
            ("enabled", False),
            ("allowed_child_models", ["luna"]),
            ("max_depth", 0),
            ("max_workers", 0),
            ("max_concurrency", 0),
        ]
        for field, value in variants:
            payload = self.route_payload()
            payload["delegation"][field] = value
            result = self.run_json(SCRIPTS["route"], payload, "--input")
            self.assertEqual(result.returncode, 0, result.stderr)
            decision = json.loads(result.stdout)
            self.assertFalse(decision["executable"], field)
            self.assertTrue(decision["authorization_required"], field)

    #
    # Given：delegation envelope 允许的历史 Worker 总数尚未耗尽，但已有 Worker 正在运行
    # When：active_workers 等于 max_concurrency 时请求继续派生
    # Then：路由器拒绝该请求，且只在活跃数量低于额度时允许派生
    # 防回归：避免把 workers_created 当作并发数量，导致一次 okok 触发超额并行
    # /
    def test_route_rejects_current_concurrency_at_the_exact_limit(self) -> None:
        payload = self.route_payload()
        payload["active_workers"] = payload["delegation"]["max_concurrency"]
        result = self.run_json(SCRIPTS["route"], payload, "--input")
        self.assertEqual(result.returncode, 0, result.stderr)
        decision = json.loads(result.stdout)
        self.assertFalse(decision["executable"])
        self.assertIn("maximum Worker concurrency", decision["reason"])

        payload["active_workers"] -= 1
        result = self.run_json(SCRIPTS["route"], payload, "--input")
        self.assertEqual(result.returncode, 0, result.stderr)
        decision = json.loads(result.stdout)
        self.assertTrue(decision["executable"])

    #
    # Given：并发额度只能由可验证的实时非负整数表示
    # When：route-decision 输入缺少 active_workers 或传入负数
    # Then：CLI fail-closed，不给出可执行路由
    # 防回归：避免缺失运行态时静默放行并发上限
    # /
    def test_route_requires_a_valid_active_worker_count(self) -> None:
        for value in (None, -1):
            payload = self.route_payload()
            if value is None:
                del payload["active_workers"]
            else:
                payload["active_workers"] = value
            result = self.run_json(SCRIPTS["route"], payload, "--input")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("active_workers must be a non-negative integer", result.stderr)

    #
    # Given：Luna 是无派生权限的叶节点 Worker
    # When：将完整 Luna 输入包交给 Worker 契约校验器
    # Then：校验器接受该合法输入
    # 防回归：避免为限制 Luna 派生而错误禁止 Luna 作为 Worker
    # /
    def test_contract_accepts_luna_leaf_worker(self) -> None:
        result = self.run_json(SCRIPTS["contract"], self.luna_leaf_payload(), "--kind", "input", "--type", "research", "--input")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("valid input", result.stdout)

    #
    # Given：Luna 父线程和 Luna 子线程派生都是硬边界
    # When：分别构造 Luna parent 与开启 delegation 的 Luna Worker 输入包
    # Then：契约校验器均 fail-closed
    # 防回归：避免只在文档中声明限制而机器校验遗漏
    # /
    def test_contract_rejects_luna_parent_and_luna_delegation(self) -> None:
        invalid_parent = self.luna_leaf_payload()
        invalid_parent["parent_model"] = "luna"
        result = self.run_json(SCRIPTS["contract"], invalid_parent, "--kind", "input", "--type", "research", "--input")
        self.assertNotEqual(result.returncode, 0)
        invalid_luna = self.luna_leaf_payload()
        invalid_luna["delegation"]["enabled"] = True
        invalid_luna["delegation"]["allowed_child_models"] = ["terra"]
        result = self.run_json(SCRIPTS["contract"], invalid_luna, "--kind", "input", "--type", "research", "--input")
        self.assertNotEqual(result.returncode, 0)

    #
    # Given：Worker completed 结果必须可由主线程独立验收
    # When：向契约校验器提交缺少证据与验证的 research completed 结果
    # Then：命令以非零状态拒绝该结果
    # 防回归：避免 V3 授权简化后同步放松结果证据边界
    # /
    def test_contract_rejects_unverifiable_completed_result(self) -> None:
        payload = {
            "status": "completed", "task_id": "r1", "parent_model": "terra", "model": "luna",
            "reasoning_effort": "low", "spawn_depth": 1, "permission": "read", "context_level": "minimal",
            "workspace": "workspace", "scope_observed": ["src"], "summary": "claimed completion",
            "evidence": [], "validation": [], "boundary_violations": [], "unresolved": [],
            "findings": [], "confidence": "high", "unknowns": [],
        }
        result = self.run_json(SCRIPTS["contract"], payload, "--kind", "result", "--type", "research", "--input")
        self.assertNotEqual(result.returncode, 0)

    #
    # Given：Skill 通过 Markdown 引用和 JSON 示例提供按需协议
    # When：解析所有本地相对链接及 JSON 围栏
    # Then：引用目标存在且每个 JSON 示例可被解析
    # 防回归：避免文档拆分后运行时断链或契约样例失效
    # /
    def test_links_and_json_examples_are_valid(self) -> None:
        sources = [SKILL, *REFERENCES.values()]
        examples = []
        for source in sources:
            text = read(source)
            for target in re.findall(r"(?<!!)\[[^]]*\]\(([^)#]+)(?:#[^)]*)?\)", text):
                self.assertTrue((source.parent / target).resolve().exists(), f"{source}: {target}")
            examples.extend(json_fences(text))
        self.assertGreater(len(examples), 0)
        for example in examples:
            json.loads(example)

    #
    # Given：根 README 与 marketplace 是 Skill 的公共安装索引
    # When：检查 V3 描述、版本和详情链接
    # Then：索引已同步原生嵌套与一次 okok 协议
    # 防回归：避免用户安装入口仍展示 V2 external fallback 行为
    # /
    def test_public_indexes_are_synchronized_for_v3(self) -> None:
        readme = read(ROOT / "README.md")
        marketplace = json.loads(read(ROOT / ".claude-plugin" / "marketplace.json"))
        entry = next(item for item in marketplace["plugins"] if item["name"] == "subagent-router")
        self.assertEqual(entry["version"], "3.0.0")
        self.assertIn("okok", entry["description"])
        self.assertIn("Luna", readme)
        self.assertIn("okok", readme)
        self.assertNotIn("external_exec", readme)
        self.assertTrue((ROOT / "skills" / "subagent-router" / "SKILL.md").is_file())

    #
    # Given：辅助脚本和总体校验器是发布前的确定性验收入口
    # When：运行每个脚本的 help 与总体 Skill 校验
    # Then：CLI 可用且 V3 语义树通过验证
    # 防回归：避免脚本改名、参数损坏或 verifier 与文档漂移
    # /
    def test_helper_clis_and_verifier_pass(self) -> None:
        for script in SCRIPTS.values():
            result = subprocess.run(["node", str(script), "--help"], cwd=ROOT, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(["node", str(SCRIPTS["verify"])], cwd=ROOT, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
