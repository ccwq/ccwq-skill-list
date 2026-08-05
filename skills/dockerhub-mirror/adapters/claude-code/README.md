# Claude Code adapter

Install the complete canonical folder:

- Project: `.claude/skills/dockerhub-mirror/`
- Personal: `~/.claude/skills/dockerhub-mirror/`

Invoke manually with `/dockerhub-mirror`, or allow model invocation for Docker Hub retrieval problems. Claude Code must resolve the installed skill directory and use the absolute `bin/dockerhub-mirror.mjs` path rather than the user's working directory.
