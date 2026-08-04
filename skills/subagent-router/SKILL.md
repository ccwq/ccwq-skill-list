---
name: subagent-router
description: Route complex or parallelizable work through temporary Codex subagents with a mandatory dispatch preview, explicit confirmation, model selection, bounded write ownership, and final integration. Use when the user asks for subagents, delegation, parallel agents, model routing, multi-agent development, or independent review.
---

# Subagent Router

Treat temporary subagents as a portfolio. Keep requirements, authorization, integration, and the final answer in the main thread. Do not create or require `.codex/agents/*.toml`; this Skill defines a reusable orchestration workflow, not persistent agent roles.

## 1. Parse the invocation

Read option tokens immediately following `$subagent-router` until the first non-option token.

- Strategy: `-l` / `--luna`, `-t` / `--terra`, or `-s` / `--sol`.
- Discussion gate: `-g` / `--grilling`.
- Combined forms: `-gl`, `-gt`, and `-gs`.
- No strategy means `-l`. `-g` alone therefore means `-gl`.

Treat the strategy as a routing profile, not a model lock. Reject conflicting strategies or unknown leading options before planning or spawning.

## 2. Design the temporary team

Read [`references/routing-policy.md`](references/routing-policy.md). Split the task into independent outcomes and choose the smallest useful team, with at most five subagents for every strategy. A valid result may use zero subagents when delegation does not earn its cost.

Do not probe the runtime model list or require model-identity verification. Assign `gpt-5.6-luna`, `gpt-5.6-terra`, or `gpt-5.6-sol` directly with an appropriate reasoning effort when spawning.

Before presenting the team:

- give each subagent one bounded outcome and completion criterion;
- mark its scope as read-only or write;
- assign exclusive files or modules to every writer;
- eliminate shared-file writes during team design;
- define the evidence and validation it must return;
- add an independent reviewer only when risk justifies one.

## 3. Enter Grilling when requested

When `-g` is present, follow [`references/grilling-protocol.md`](references/grilling-protocol.md). Keep investigation and discussion in the main thread. After shared understanding, continue to the same mandatory dispatch preview used by non-Grilling invocations.

Without `-g`, proceed directly from task analysis to the dispatch preview.

## 4. Show the mandatory dispatch preview

Before spawning any subagent or starting planned writes, show the complete proposed team:

`group | outcome | scope | permission | model | reasoning | owned files/modules | validation`

For a main-thread-only decision, show `0 subagents`, the reason, and the main-thread validation plan. For an unconfirmed team, do not start read-only agents early.

The user may add, remove, merge, split, or edit groups, models, reasoning, permissions, ownership, and validation. After any adjustment, show the full revised preview again; all earlier confirmations become invalid.

## 5. Wait for confirmation

Only the exact phrase `确认分发` confirms the current complete preview. It authorizes the listed in-scope execution under the current sandbox and permission boundaries. Actions outside the current task or permissions remain blocked and must be resolved before the preview is confirmable.

Do not require a second `授权执行` gate. Ambiguous approval, confirmation of only one group, or approval of an older preview does not authorize execution.

## 6. Spawn bounded temporary subagents

After `确认分发`, spawn the approved temporary subagents with their listed model, reasoning effort, task boundary, permission boundary, owned files or modules, and return contract. Do not silently change models.

If a spawn fails, report the failed group, requested model, and unexecuted scope. Return to a revised full dispatch preview and wait for a new `确认分发`; do not substitute another model automatically.

Every subagent returns only:

1. task boundary;
2. evidence with file locations or source references;
3. result;
4. validation performed;
5. unresolved questions or risks.

## 7. Integrate and verify

Wait for every required group. Resolve disagreements against evidence rather than agent count. The main agent owns conflict resolution, final validation, and the final answer.

Report every attempted group as:

`group | task | requested model | reasoning | permission | status | evidence`

Completion requires all groups accounted for, writes kept inside their exclusive ownership, conflicts resolved or exposed, final validation reported, and remaining risks stated.
