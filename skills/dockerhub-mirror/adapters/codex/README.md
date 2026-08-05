# Codex adapter

Install the complete canonical folder:

- Project: `.codex/skills/dockerhub-mirror/`
- User: `$CODEX_HOME/skills/dockerhub-mirror/` (commonly `~/.codex/skills/dockerhub-mirror/`)

Keep the entry filename `SKILL.md`. When executing the bundled CLI, Codex must resolve the installed skill directory and use the absolute `bin/dockerhub-mirror.mjs` path; the user's working directory is unrelated.
