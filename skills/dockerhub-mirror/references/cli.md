# CLI reference

This file is the authoritative command and flag reference. Resolve `<skill-root>` to the absolute directory containing `SKILL.md`, then invoke:

```text
node "<skill-root>/bin/dockerhub-mirror.mjs" <flags>
```

Node accepts the quoted absolute path on Windows, Linux, and macOS. Do not build commands relative to the user's current working directory.

## Side-effect classes

| Mode | Network | Cache write | Authorization |
|---|---:|---:|---|
| `--list`, `--quarantine`, `--help` | No | No | Read-only |
| `--dry-run` with quick/deep/image flags | Yes | No | Read-only |
| default quick check, `--deep` | Yes | Yes | Write gate in `SKILL.md` |
| `-f/--scrape` | Yes | Yes | Write gate in `SKILL.md` |
| `--add`, `--remove`, `--retry-quarantine` | Maybe/Yes | Yes | Write gate in `SKILL.md` |

`--dry-run` suppresses cache creation and mutation, including when combined with `--add` or `--remove`; use those combinations only to preview an already agreed operation.

## Modes

```text
(no primary flag)          Quick-test active records, or built-in seeds when cache is empty
-f, --scrape               Scrape built-in sources; deep-test and ingest only new qualified URLs
--deep                     Deep-test active candidates with a bounded blob sample
--add <url>                Deep-test one URL and add it only when qualified
--remove <url>             Remove one URL from active or quarantine records
--list                     List active records without network access
--quarantine               List quarantine records without network access
--retry-quarantine         Deep-test quarantined records; restore or retire them
```

Choose only one primary mode among scrape, add, remove, list, quarantine, and retry-quarantine.

## Safety and output flags

```text
--dry-run                  Perform probes and render recommendations without writing cache
--image <ref>              Generate, but do not execute, a replacement Docker pull command
--json                     Emit machine-readable JSON
--verbose                  Include scenario winners, raw metrics, and source details
```

## Overrides

```text
--config <path>            Use a non-default INI path
--timeout <ms>             Override per-request timeout
--concurrency <n>          Override concurrent probes
--max-age <days>           Override the stale-age threshold
-h, --help                 Print CLI help
```

The environment variable `DOCKERHUB_MIRROR_CONFIG` also overrides the cache path.

## Default cache path

The CLI resolves the user's home directory with Node's `os.homedir()` and joins `.config/dockerhub-mirror-skill.ini`:

- Windows: `%USERPROFILE%\.config\dockerhub-mirror-skill.ini`
- Linux/macOS: `~/.config/dockerhub-mirror-skill.ini`

## Examples

Replace `<skill-root>` with the absolute installed path.

```text
node "<skill-root>/bin/dockerhub-mirror.mjs" --dry-run --image nginx:1.27
node "<skill-root>/bin/dockerhub-mirror.mjs" --dry-run --deep --json
node "<skill-root>/bin/dockerhub-mirror.mjs" --list
node "<skill-root>/bin/dockerhub-mirror.mjs" --deep
node "<skill-root>/bin/dockerhub-mirror.mjs" -f
node "<skill-root>/bin/dockerhub-mirror.mjs" --add https://mirror.example.com
node "<skill-root>/bin/dockerhub-mirror.mjs" --retry-quarantine
```

## Result interpretation

- Exit `0`: the requested mode completed and, for probe modes, a qualified recommendation exists.
- Exit `2`: the mode completed but no candidate qualified or an add request was rejected.
- Exit `1`: argument, configuration, filesystem, or unexpected runtime failure.

Live results apply to the current host, DNS path, ISP, and test time. A successful public proxy test does not establish supply-chain trust.
