---
name: dockerhub-mirror
description: Triage Docker Hub pull latency and registry failures. Use when docker pull or the image-download phase of docker run stalls, when Docker Hub returns network, TLS, token, or rate-limit errors, or when the user asks to test, rank, refresh, discover, or manage mirror candidates.
---

# Docker Hub Mirror Triage

Use a **triage** process: classify the request, probe the smallest safe surface, qualify every candidate, then recommend an evidence-backed mirror.

Resolve `<skill-root>` to the absolute directory containing this `SKILL.md`. Invoke the bundled CLI as:

```text
node "<skill-root>/bin/dockerhub-mirror.mjs" <flags>
```

Never assume the current working directory is the skill directory.

## Authorization gate

The state sequence is `讨论中 → 待共识 → 待授权 → 执行中 → 已完成`.

- Before the exact consensus phrase `ok`, limit activity to questions, analysis, read-only research, comparison, and `--dry-run` probes. A requested operation is a goal, not authorization.
- After `ok`, present a bounded plan and request the exact execution phrase `授权执行`.
- After `授权执行`, perform only the agreed write-capable branch. A changed scope, cost, risk, or execution path returns to discussion.
- Keep replacement Docker commands as output only. Never modify Docker daemon settings, restart Docker, execute `docker pull` or `docker run`, or send private-image credentials through a public mirror.

When a new operational request still needs decisions, or a previous assumption is invalidated, read [the extended discussion protocol](references/decision-gate.md) before asking questions.

## Step 1 — Classify the branch

Choose exactly one branch:

- **Diagnostic:** observed slow or failed Docker Hub image download.
- **Existing-candidate check:** test or rank cached/built-in candidates.
- **Discovery:** scrape built-in source pages for previously unseen candidates.
- **Cache management:** add, remove, list, quarantine, or retry a recorded candidate.

Mark the branch as read-only or write-capable. Diagnostic probes and explicit read-only checks use `--dry-run`; discovery and cache mutation are write-capable even when their network requests are read-only.

**Complete when:** one branch is selected and its authorization requirement is explicit.

## Step 2 — Establish the target and evidence

For `docker pull`, capture the image reference and the observed error or stall. For `docker run`, first establish that the delay occurs while resolving or downloading the image rather than after the container starts.

Treat timeout, TLS handshake, connection reset, unexpected EOF, HTTP 429, anonymous-token failure, manifest delay, and prolonged transfer silence as Docker Hub retrieval evidence. Preserve a digest when the image uses one. Do not rewrite non-Docker-Hub image references.

**Complete when:** the image target, retrieval evidence, and Docker Hub applicability are known, or explicitly recorded as unavailable.

## Step 3 — Construct the minimum safe command

Read [the CLI reference](references/cli.md) only after the branch is selected. Build the command with the absolute `<skill-root>` entrypoint.

- Diagnostic or unauthorized check: use `--dry-run`; add `--image <ref>` when an image is known.
- Authorized check: use quick mode by default and `--deep` when throughput evidence is required.
- Authorized discovery: use `-f/--scrape`.
- Authorized cache management: use the corresponding CRUD or quarantine flag.

Prefer quick probes for triage. Use deep probes for newly discovered candidates, explicit throughput comparison, or quarantine recovery.

**Complete when:** the exact command is constructed, its side effects are understood, and every write-capable invocation has valid authorization.

## Step 4 — Probe every selected candidate

Run the command and retain each candidate's success, failure, or timeout result.

Quick mode verifies Registry API and manifest retrieval. Deep mode additionally measures first-byte latency and a bounded blob sample. A `401` challenge from `/v2/` is not itself failure when token flow and manifest retrieval succeed.

**Complete when:** every selected candidate has a terminal probe result and no candidate is silently omitted.

## Step 5 — Qualify and update state

Apply hard qualification before relative scoring:

- Quick qualification requires successful API and manifest retrieval.
- Deep qualification also requires the configured minimum bounded-blob throughput.
- `--dry-run` leaves the cache unchanged.
- A successful authorized check updates measurements and clears consecutive failures.
- One authorized failure degrades a recorded candidate; reaching the configured consecutive-failure threshold quarantines it.
- Discovery normalizes and deduplicates URLs, skips every active or quarantined record, deep-tests only new candidates, and stores only qualified results.

The CLI owns cache parsing, locking, atomic replacement, status migration, and INI serialization; do not edit the cache directly during a probe branch.

**Complete when:** every candidate is qualified or rejected and any authorized cache change is atomically committed or reported as failed.

## Step 6 — Rank and recommend

Rank qualified candidates using the configured mix of manifest latency, blob throughput, historical success rate, API latency, freshness, and consecutive-failure penalty.

Default output should identify the comprehensive best candidate, backups, the evidence used, and an unexecuted replacement `docker pull` command when an image is known. Use detailed or JSON output only when the user needs raw metrics or scenario-specific winners.

Suggest discovery when active records are empty, all tested candidates fail, or a cache classified as expired has no qualified result. Cache age alone does not invalidate a candidate; use the thresholds in `config/defaults.json`.

State that public-proxy reachability measures current transport behavior, not operator trust or nationwide performance.

**Complete when:** the recommendation is evidence-backed, alternatives and limitations are visible, and no generated Docker command has been executed.

## Step 7 — Close the branch

Report the selected branch, command mode, cache side effects, qualified and rejected counts, recommendation, and unresolved risks. For write-capable work, declare completion only after the CLI exits successfully and the expected state can be read back.

**Complete when:** the user can distinguish what was observed, what changed, what was only recommended, and what remains unverified.
