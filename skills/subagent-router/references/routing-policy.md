# Routing Policy

Use this file after parsing the invocation and before showing the mandatory dispatch preview.

## Decide whether to delegate

Delegate when an independent workstream gains from parallelism, context isolation, specialization, or independent review. Keep work in the main thread when it is small, tightly serial, cheaply solved with current context, or cannot be divided without shared writes.

Every strategy uses the smallest useful team and allows at most five temporary subagents. The strategy does not control agent count.

## Match work to models

- **Luna** — exploration, inventory, classification, narrow searches, repetitive checks, formatting, and other mechanical work with a clear oracle. Treat Luna as read-only by default; the main agent may assign simple mechanical writes when it judges them sufficiently bounded and verifiable.
- **Terra** — everyday coding analysis, tool-heavy exploration, implementation, tests, ordinary refactors, and broad read-heavy work.
- **Sol** — architecture, security, ambiguous diagnosis, high-impact decisions, weak verification oracles, central design judgments, and independent high-risk review.

Use the lowest reasoning effort that reliably meets the completion criterion. Prefer `low`, `medium`, and `high`; reserve `xhigh` for exceptional work when explicitly supported by the execution surface.

Do not query available model types before planning. Assign the requested model directly when spawning. Do not require runtime model-identity verification as a completion gate.

## Apply strategy profiles

### `-l` / `--luna` — cost-first, default

- Prefer Luna for exploration and mechanical work.
- Use Terra when implementation or tool-heavy work needs it.
- Use Sol only for high-risk or central judgments.
- Default reasoning: Luna `low`; Terra `low` or `medium`; Sol `high`.

### `-t` / `--terra` — balanced

- Use Luna for lightweight exploration and mechanical work.
- Prefer Terra for most analysis, implementation, and tests.
- Use Sol for architecture, security, difficult diagnosis, or final high-risk review.
- Default reasoning: Luna `low`; Terra `medium`; Sol `high`.

### `-s` / `--sol` — quality-first

- Keep Luna for mechanical work with a clear oracle.
- Use Terra for routine implementation.
- Prefer Sol for core design, difficult judgments, high-impact analysis, and independent review.
- Default reasoning: Luna `medium`; Terra `medium` or `high`; Sol `high`, with `xhigh` only for exceptional supported work.

Profiles change model-selection and reasoning tendencies, not concurrency, fixed quotas, or model locks. Mix models dynamically according to each group’s work.

## Design write ownership before dispatch

Assign every writer exclusive files or modules while designing the team. Do not create a plan in which two agents modify the same file or shared code region. If a shared file cannot be separated, give it to one writer and make the other groups read-only, advisory, or dependent on that writer’s result.

Prefer parallel read-heavy work. Parallel writes are allowed only across non-overlapping ownership boundaries.

## Add review only when it earns its cost

Use the main agent for final validation of ordinary, directly verifiable changes. Add an independent reviewer for security, architecture, cross-module behavior, high-impact writes, difficult diagnosis, or weak validation oracles. Do not create a reviewer for every write by default.

## Show the complete dispatch preview

Always show the proposed dispatch before spawning, including a main-thread-only decision:

`group | outcome | scope | permission | model | reasoning | owned files/modules | validation`

Explain why each delegated group earns its cost. Wait for `确认分发`. Any adjustment invalidates earlier confirmation and requires a new full preview.

## Handle spawn failure

Do not silently substitute or inherit another model after a spawn failure. Report the failed group, requested model, and unexecuted scope. Revise the complete preview and wait for a new `确认分发`.

## Final report

For every attempted group, report:

- role and bounded task;
- why delegation earned its cost;
- requested model and reasoning effort;
- permissions and owned files or modules;
- evidence and validation;
- success, spawn failure, cancellation, or unresolved status.
