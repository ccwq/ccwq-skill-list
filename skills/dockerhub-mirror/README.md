# Docker Hub Mirror Skill

A cross-platform Agent Skill with a dependency-free Node.js CLI for Docker Hub mirror triage. It diagnoses pull latency, tests and ranks candidates, maintains a local INI cache, incrementally discovers new candidates, and generates replacement pull commands without executing them.

## Requirements

- Node.js 18.17 or newer
- Windows 10/11, Linux, macOS, or another Node-supported POSIX-like system
- Network access for live Registry probes

No npm dependencies or Docker daemon access are required for the detector itself.

## Install

Copy the entire folder so `SKILL.md`, `bin/`, `scripts/`, `config/`, and `references/` remain together.

| Platform | Project installation | User installation |
|---|---|---|
| Codex | `.codex/skills/dockerhub-mirror/` | `$CODEX_HOME/skills/dockerhub-mirror/` |
| Claude Code | `.claude/skills/dockerhub-mirror/` | `~/.claude/skills/dockerhub-mirror/` |
| Generic Agent Skills | framework-specific skill directory | framework-specific user skill directory |

Claude Code manual invocation is `/dockerhub-mirror`. Codex and compatible agents may select the skill from its description or by explicit name.

## Runtime entrypoint

Agents and humans should invoke the absolute installed path rather than assuming the current directory:

```text
node "/absolute/path/to/dockerhub-mirror/bin/dockerhub-mirror.mjs" --help
```

Optional standalone command installation:

```text
npm link
```

Then run `dockerhub-mirror --help`.

## Authoritative documentation

- [SKILL.md](SKILL.md): runtime branches, ordered steps, completion criteria, and safety gate.
- [references/cli.md](references/cli.md): commands, flags, side effects, paths, and exit codes.
- [references/decision-gate.md](references/decision-gate.md): extended discussion, consensus, authorization, staging, and rollback protocol.
- [config/defaults.json](config/defaults.json): thresholds, limits, test image, quarantine policy, and scoring weights.

## Development verification

```text
npm test
npm run lint
npm run check
```

Tests use local mock registries and temporary directories; they do not require Docker or public network access.
