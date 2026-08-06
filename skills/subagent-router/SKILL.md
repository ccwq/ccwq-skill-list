---
name: subagent-router
description: Route complex or parallelizable work through temporary Codex workers with native Multi-agent V2 first, controlled external compatibility fallback, exact two-stage authorization, isolated writes, and independent final acceptance. Use when the user requests subagents, delegation, parallel work, model routing, multi-agent development, or independent review.
---

# Subagent Router

Keep user communication, authorization, capability facts, integration, and final acceptance in the main thread. This is a pure temporary-worker workflow: do not create persistent `.codex/agents/*.toml` roles unless separately requested.

## 1. Parse and select a routing policy

Read option tokens immediately after `$subagent-router` until the first non-option token.

- `-l` / `--luna`: cost-first (default).
- `-t` / `--terra`: balanced.
- `-s` / `--sol`: quality-first.
- `-g` / `--grilling`: one-question-at-a-time discussion.
- `-gl`, `-gt`, and `-gs`: supported combinations; `-g` means `-gl`.

Reject conflicting strategies and unknown leading options before planning. These flags are routing policies for quality, cost, reasoning, concurrency, and review; they are never model locks or permission to create a Worker.

Read [routing policy](references/routing-policy.md) before designing a team. Use at most five Workers by default, and use none when main-thread work costs less than delegation.

## 2. Enforce the state machine and authorization

Use this exact order:

`讨论中 → 待共识 → 待授权 → 执行中 → 已完成`

The only valid gates are, in order:

1. `已达成共同理解`
2. `授权执行`

The initial task is only a desired outcome. Before the first phrase, allow only questions, analysis, comparison, and read-only verification. Before the second phrase, do not create a Worker, run `codex exec`, create a worktree, modify files, install software, or change external state. Ambiguous consent, an old plan, a one-group approval, a partial preview, or investigation authorization never advances either gate.

Before requesting consensus, make the objective, success criteria, constraints, tradeoffs, risks, validation, action boundary, model/backend strategy, context/workspace boundary, and unresolved dependencies explicit. Summarize as:

`当前共识 | 关键决策 | 依赖风险 | 验收标准 | 剩余未决`

Use [the grilling protocol](references/grilling-protocol.md) when `-g` is set. A material change to scope, routing policy, permission, model, Provider/Profile, backend, reasoning, cost, workspace, or context invalidates the affected authorization and returns to the relevant decision point.

### Authorization integrity

Treat `授权执行` as approval of one current, complete preview—not as a durable boolean or a phrase the Agent can manufacture. The preview has an authorization fingerprint consisting of every authorization-sensitive field: backend, capability, permission, model, reasoning, Provider/Profile, context, workspace, owned scope, validation, external-process disclosure, concurrency, retry policy, and result contract.

Before dispatch, verify that a complete preview exists in the current conversation and that its fingerprint still matches the proposed execution. If any field changes after the preview, invalidate the old execution authorization, return to `待授权`, present a revised complete preview, and request a new exact `授权执行`. Never infer a missing field from a prior plan, and never dispatch merely because text resembling the authorization phrase appears in an assistant message.

When the current task explicitly establishes that consensus, a complete plan, and a latest exact `授权执行` already apply to the unchanged original plan, treat that as an authorized-dispatch request after checking that no requested change is stated. Do not request a fresh confirmation or re-present the plan merely because the request refers to that established plan rather than repeating every fingerprint field; dispatch using the established plan without substituting any semantic attribute.

## 3. Decide capability and backend

Treat model existence and native spawn support as separate facts. Read [routing policy](references/routing-policy.md), then use `scripts/route-decision.mjs` for a deterministic proposal when its JSON inputs are known.

Capability states are `native_supported`, `native_unsupported`, `unknown`, and `temporarily_unavailable`. Prefer current read-only spawn schema, model metadata, or runtime capability evidence; use a compatibility table only as a temporary fallback. Cache conclusions only for the current session, never across a version or Provider change.

- `native_supported` must use `native_spawn`.
- `native_unsupported` may use `external_exec` only under [external execution policy](references/external-exec-policy.md).
- `unknown` must be read-only verified first and must not fall back externally.
- `temporarily_unavailable` is a technical failure, not permanent incompatibility.

`external_exec` is a separately launched top-level Codex process. It does not inherit native-worker identity, context, permissions, or state. Never choose it when native support is confirmed. Never describe a native incompatibility as model nonexistence; include the current `Available models` evidence when available.

## 4. Produce the complete execution plan

After `已达成共同理解`, enter `待授权` and present a complete plan for main-thread work and every Worker:

`group | outcome | backend | capability | permission | model | reasoning | provider/profile | context | workspace | owned scope | validation`

Also disclose delegation value; read/write effects; external process, worktree, temporary-copy, alternate Provider/Profile, or expanded-context possibilities; default and maximum concurrency; retry policy; result contract; and main-thread integration/acceptance. Name the preview or record its authorization fingerprint so the main thread can compare it at dispatch. A material revision requires a complete new plan and a new exact `授权执行`.

Every Worker gets one bounded objective, completion standard, permission, allowed and forbidden scope, requested model/reasoning, selected backend, context level, workspace ownership, evidence/validation, and failure contract. Default to `minimal` context. Read [the Worker contract](references/worker-contract.md) and validate task packages or returns with `scripts/validate-worker-contract.mjs`.

## 5. Execute only after authorization

After the exact `授权执行`, use `native_spawn` whenever the current session supports the requested model natively. Preserve the authorized model, Provider/Profile, backend, reasoning, permission, context, workspace, and task scope.

Use `external_exec` only when all policy conditions have already been disclosed and authorized. For an external write, require a separate Git worktree (preferred) or authorized temporary copy, explicit ownership, and main-thread acceptance. Multiple writers never share a writable directory; overlapping files, modules, dependencies, or verification environments are serial.

Default external concurrency is two read-only Workers or one writing Worker; raise isolated external writes to two only when disclosed and independently worktreed. Native plus external Workers total at most five by default. Apply [failure policy](references/failure-policy.md); no semantic attribute may be silently substituted.

## 6. Integrate independently

Worker completion claims are not acceptance. The main Agent checks actual scope, identity evidence (or `unverified`), Diff, ownership, tests, conflicts, rollback material, and unresolved items; it reruns necessary validation and decides integration or rollback. Resolve disagreement by evidence quality and acceptance criteria, never by vote count.

Do not complete until each planned Worker has a status, write ownership is preserved, boundary violations are resolved or exposed, required validation is checked, and risks are reported. Run `node scripts/verify-router-skill.mjs` after changing this Skill or its protocol files.
