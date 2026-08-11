# Routing Policy

Read this before a dispatch plan. Delegate only for independent parallel work, context isolation, specialization, bulk throughput, or independent review. Keep small, strongly serial, cheaply direct, continuously main-thread-dependent, overlapping-write, or integration-heavy work in the main thread.

## Policy flags

-l is the default cost-first policy: favor narrow leaf work, low reasoning, small teams, and direct validation. Luna is valid for leaf work but cannot create children. -t is balanced: favor Terra for ordinary analysis, implementation, tests, and tools; add review for risk. -s is quality-first: favor Sol/high reasoning and independent review for complex or high-impact decisions, while retaining cheaper capability for simple work.

Policies change selection tendencies, reasoning, team size, concurrency, and review—not a fixed model identity. Recommend a different model when evidence is weak, but never silently substitute it.

## Native nesting

Identify the parent model before every native spawn.

| Parent model | Allowed children |
|---|---|
| Luna | none |
| Terra | Luna, Terra, Sol within its envelope |
| Sol | Luna, Terra, Sol within its envelope |

If the main thread is Luna, it cannot dispatch. Report that fact and offer direct work or a new Router run from Terra or Sol. Do not launch a separate compatibility process.

## Delegation envelope

The initial preview and every delegating Worker package state:

- enabled: whether the Worker may create children;
- allowed_child_models: one or more of luna, terra, sol;
- max_depth: root is depth 0; a new child must not exceed this depth;
- max_workers: total native Workers allowed by the plan;
- max_concurrency: simultaneous native Workers allowed by the plan.

Before every spawn, the dispatcher supplies active_workers: the current number of running native Workers within this envelope. A new child is allowed only when active_workers is strictly below max_concurrency; workers_created remains the historical total and cannot be used as a concurrency proxy.

The envelope is an authorization boundary, not a model-capability restriction. Within it, Terra and Sol can adapt their task tree without another confirmation. A requested child outside it requires a revised preview and a new okok.

Use node scripts/route-decision.mjs <input.json> to make a proposed child decision reproducible. The input identifies the parent and requested models, exact authorization message, current depth/count, and delegation envelope.

## Team design

Give each Worker one outcome, measurable completion criterion, permission, model/reasoning preference, context level, owned scope, delegation envelope, and return requirements. Default context is minimal; summarized adds selected dependency context, and expanded must appear in the preview whenever it changes privacy, cost, or data boundaries.

Give every writer exclusive files or modules. Keep shared ownership with one writer and make dependent groups advisory or serial. Add an independent reviewer only for security, architecture, weak oracles, difficult diagnosis, or high-impact writes.

The concise plan uses: role | goal | model/reasoning | permission and owned scope | validation | delegation envelope.
