# Routing Policy

Read this before a dispatch plan. Delegate only for independent parallel work, context isolation, specialization, bulk throughput, or independent review. Keep small, strongly serial, cheaply direct, continuously main-thread-dependent, overlapping-write, or integration-heavy work in the main thread. The normal total cap is five Workers.

## Policy flags

`-l` is the default cost-first policy: favor narrow tasks, low reasoning, small teams, direct validation, and Luna only when the authorized backend supports it. `-t` is balanced: favor Terra for ordinary analysis, implementation, tests, and tools; add review for risk. `-s` is quality-first: favor Sol/high reasoning and independent review for complex or high-impact decisions, while retaining cheaper capability for simple work.

The policies change selection tendencies, reasoning, team size, concurrency, and review—not a fixed model identity. Recommend an upgrade when evidence is weak, but never silently upgrade.

## Capability facts and route selection

Maintain one current-session capability fact per requested model: `native_supported`, `native_unsupported`, `unknown`, or `temporarily_unavailable`.

1. Prefer the current spawn schema, model metadata, or other read-only runtime capability evidence.
2. If unavailable, use a known compatibility table only as a temporary `unknown`-preserving fallback.
3. After authorized native failure, record the error and `Available models` text.
4. Do not carry the conclusion across sessions, Codex versions, or Provider changes.

| Capability | Route |
|---|---|
| `native_supported` | `native_spawn`, always |
| `native_unsupported` | Evaluate the controlled `external_exec` path |
| `unknown` | Low-cost read-only verification; never external fallback |
| `temporarily_unavailable` | Technical retry path; do not infer incompatibility |

Use `node scripts/route-decision.mjs <input.json>` to make this decision reproducible. The input must identify capability, permission, execution authorization, external-plan disclosure, top-level availability, and write isolation.

## Team design

Give each Worker one outcome, measurable completion criterion, permission, model/reasoning preference, backend, context level, owned scope, and return requirements. Default context is `minimal`; `summarized` adds selected dependency context, and `expanded` requires renewed authorization if it changes privacy, cost, or data boundaries.

Give every writer exclusive files or modules. Keep shared ownership with one writer and make dependent groups advisory or serial. Add an independent reviewer only for security, architecture, weak oracles, difficult diagnosis, or high-impact writes.

The full plan uses: `group | outcome | backend | capability | permission | model | reasoning | provider/profile | context | workspace | owned scope | validation`.
