# Generic Agent Skills adapter

Install the repository root as one Agent Skill. The framework must load `SKILL.md`, preserve the sibling `bin/`, `scripts/`, `config/`, and `references/` directories, and support Node.js command execution.

Before invoking the CLI, resolve the absolute directory containing `SKILL.md`; do not assume the current working directory is the skill root.
