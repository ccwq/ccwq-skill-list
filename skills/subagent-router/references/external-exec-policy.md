# External Execution Policy

`external_exec` is a controlled compatibility route for an independent top-level Codex process, not a native V2 Worker. It does not inherit context, state, identity, or permission.

## Entry and prohibition

Allow it only after `授权执行` when all are true: the requested model is currently `native_unsupported`; it is top-level callable or has a verifiable Profile; the complete plan disclosed the external process; permissions, cost, context, and workspace are authorized; a minimal sufficient task package is possible; and actual identity can be verified or returned as `unverified`.

Never use it for `native_supported`, `unknown`, or a silent change of model, Provider/Profile, backend, reasoning, permission, context, workspace, or scope. A read-only single-Worker fallback can avoid another confirmation only when the existing authorization disclosed it and Provider, credentials, Profile, directory, permission, context exposure, and cost remain unchanged.

## Context, isolation, and concurrency

Use `minimal` by default: goal, necessary facts, allowed scope, forbidden actions, and output/acceptance contract. `summarized` adds selected background; `expanded` requires renewed authorization if it expands privacy, cost, or data boundary. Missing context is a reported blocker, never a reason to read more.

For `external_exec + write`, require `independent workspace + explicit ownership + main-agent acceptance`. Prefer a Git worktree; use an authorized temporary copy only for non-Git work. Without reliable isolation, downgrade to read-only. Never let writing Workers share a writable directory. Serialize overlapping files, modules, dependencies, or test environments. Workers never merge the main branch.

Default maximum external concurrency is two read-only Workers or one writer. Two writers are allowed only when all writes are independent, each has a distinct worktree, and the plan disclosed the increase. Native and external Workers total at most five by default.
