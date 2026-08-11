---
name: subagent-router
description: Route complex or parallelizable work through temporary native Codex workers with model-aware nesting, one exact okok authorization, bounded delegation envelopes, and independent final acceptance. Use when the user requests subagents, delegation, parallel work, model routing, multi-agent development, or independent review.
---

# Subagent Router

Keep user communication, authorization, integration, and final acceptance in the main thread. This workflow creates only temporary native Workers; do not create persistent .codex/agents/*.toml roles unless separately requested.

## 1. Parse and select a routing policy

Read option tokens immediately after $subagent-router until the first non-option token.

- -l / --luna: cost-first (default).
- -t / --terra: balanced.
- -s / --sol: quality-first.
- -g / --grilling: one-question-at-a-time discussion.
- -gl, -gt, and -gs: supported combinations; -g means -gl.

Reject conflicting strategies and unknown leading options before planning. Policies tune quality, cost, reasoning, concurrency, and review; they are not model locks or permission to create a Worker.

Read [routing policy](references/routing-policy.md) before designing a team. Use no Worker when main-thread work costs less than delegation. Start with at most five Workers by default; a different total must appear in the authorized delegation envelope.

## 2. Discuss, preview, and authorize once

The state sequence is:

讨论中 → 待授权 → 执行中 → 已完成

The initial task is only a desired outcome. During discussion, perform questions, analysis, comparisons, and read-only verification only. When the objective, success criteria, constraints, risks, validation, action boundary, model strategy, workspace boundary, and dependencies are clear, present the current execution preview.

The preview is concise by default. For the main thread and every initial Worker, show:

role | goal | model/reasoning | permission and owned scope | validation | delegation envelope

A delegation envelope records whether the Worker may create children, the allowed child models, maximum depth, maximum total Workers, and concurrency. Reveal context expansion, temporary-copy/worktree use, retries, or other exceptional boundaries only when they apply.

Only one user message can authorize the current preview: after removing leading and trailing whitespace, it must exactly equal lowercase okok. It is valid only after the latest preview. A quoted example, code block, or longer sentence containing okok is not authorization.

Treat okok as approval of one current preview, never as a durable boolean. A material change to model, reasoning, permission, owned scope, validation, context/workspace, concurrency, or delegation envelope invalidates the preview. Present the revised preview and wait for a new exact okok.

Use [the grilling protocol](references/grilling-protocol.md) when -g is set.

## 3. Apply native model and nesting rules

Use native Worker creation only: every approved child uses native_spawn. Before a spawn, identify the parent model and the current number of active native Workers from runtime metadata, then validate the requested child against the current delegation envelope with scripts/route-decision.mjs. Pass the live count as active_workers; never infer it from the historical workers_created total.

- A Luna parent cannot create any child Worker. If the main thread is Luna, stop dispatch and offer direct main-thread work or a new Router run from Terra or Sol.
- Luna may be selected as a leaf Worker by a Terra or Sol parent.
- Terra and Sol may create Luna, Terra, or Sol children when the current envelope permits it.
- A child may create further Workers only when its own envelope permits it. Model capability is not artificially flattened; depth, quantity, permission, scope, and concurrency remain the user-approved boundary.

Never fabricate a parent model. If it cannot be determined cheaply from current runtime evidence, report the blocker instead of dispatching.

## 4. Package and execute

Every Worker gets one bounded objective, completion standard, permission, allowed and forbidden scope, requested model/reasoning, context level, workspace ownership, delegation envelope, evidence/validation, and failure contract. Default context is minimal. Read [the Worker contract](references/worker-contract.md) and validate task packages or returns with scripts/validate-worker-contract.mjs.

After an exact okok, create only the native Workers described by the current preview. Preserve the authorized model, reasoning, permission, context, workspace, scope, validation, and delegation envelope. Give writers exclusive files or modules; serialize overlapping files, dependencies, and verification environments.

Apply [failure policy](references/failure-policy.md). A Worker must not silently substitute model, reasoning, permission, scope, or delegation bounds.

## 5. Integrate independently

Worker completion claims are not acceptance. The main Agent checks actual scope, model evidence (or unverified), diff, ownership, tests, conflicts, rollback material, and unresolved items; it reruns necessary validation and decides integration or rollback. Resolve disagreement by evidence quality and acceptance criteria, never by vote count.

Do not complete until each planned Worker has a status, write ownership is preserved, boundary violations are resolved or exposed, required validation is checked, and risks are reported. Run node scripts/verify-router-skill.mjs after changing this Skill or its protocol files.
