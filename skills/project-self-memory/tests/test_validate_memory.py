from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from importlib.util import module_from_spec, spec_from_file_location


SCRIPT = Path(__file__).parents[1] / "scripts" / "validate_memory.py"
SPEC = spec_from_file_location("validate_memory", SCRIPT)
assert SPEC and SPEC.loader
MODULE = module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def write_memory(path: Path, extra: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n\n".join(MODULE.HEADER_LINES) + "\n" + extra, encoding="utf-8")


class ValidateMemoryTests(unittest.TestCase):
    def make_project(self) -> tuple[Path, Path]:
        project_root = Path(tempfile.mkdtemp()) / "demo-project"
        skill_path = project_root / ".agents" / "skills" / "project-self-memory"
        skill_path.mkdir(parents=True)
        return project_root, skill_path

    def test_accepts_project_local_skill_and_complete_memory(self) -> None:
        """
        Given：skill 位于项目级规范路径且 memory.md 包含完整来源头
        When：执行项目记忆契约校验
        Then：校验不返回错误
        防回归：项目级 skill 被误判为全局安装或初始记忆文件无法通过校验
        """
        project_root, skill_path = self.make_project()
        write_memory(project_root / "self-memory" / "memory.md")

        self.assertEqual(MODULE.validate(project_root, skill_path, True), [])

    def test_rejects_non_project_skill_location(self) -> None:
        """
        Given：memory.md 合法但 skill 位于项目外的用户级目录
        When：执行项目记忆契约校验
        Then：结果指出必须迁移到项目 `.agents/skills/` 路径
        防回归：全局安装仍能读写任意项目记忆
        """
        project_root, _ = self.make_project()
        write_memory(project_root / "self-memory" / "memory.md")
        global_skill = Path(tempfile.mkdtemp()) / "project-self-memory"

        errors = MODULE.validate(project_root, global_skill, True)

        self.assertEqual(len(errors), 1)
        self.assertIn("必须安装在", errors[0])

    def test_rejects_missing_source_header(self) -> None:
        """
        Given：skill 位于规范路径但 memory.md 缺少来源头
        When：执行项目记忆契约校验
        Then：结果列出缺失的来源或维护说明
        防回归：用户无法从 memory.md 文件开头追溯其生成与维护规则
        """
        project_root, skill_path = self.make_project()
        memory_path = project_root / "self-memory" / "memory.md"
        memory_path.parent.mkdir(parents=True)
        memory_path.write_text("# 项目自记忆\n", encoding="utf-8")

        errors = MODULE.validate(project_root, skill_path, True)

        self.assertTrue(any("缺少必需" in error for error in errors))

    def test_rejects_credential_shaped_content(self) -> None:
        """
        Given：memory.md 的结论中出现疑似明文凭据
        When：执行项目记忆契约校验
        Then：结果要求改为可公开的结论表述
        防回归：自进化过程把密钥或密码沉淀到项目长期记忆
        """
        project_root, skill_path = self.make_project()
        write_memory(
            project_root / "self-memory" / "memory.md",
            "\n## Deployment\n\n- [事实] token=very-secret-value-12345\n",
        )

        errors = MODULE.validate(project_root, skill_path, True)

        self.assertTrue(any("敏感凭据" in error for error in errors))
