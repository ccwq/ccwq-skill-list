# Failure Policy

Never silently change model, Provider/Profile, backend, reasoning effort, permission, context level, workspace, or task scope. A proposed change must state cause, expected effect, cost, risk, and validation impact; request renewed authorization whenever it changes an authorized boundary.

## Classify and act

| Class | Examples | Required action |
|---|---|---|
| Technical temporary | interruption, network failure, rate limit, JSONL interruption, temporary service outage | Retry once with the identical model, Profile, backend, reasoning, permission, context, workspace, and task package; record both attempts, then return `failed` or `blocked`. |
| Capability | `Unknown model`, absent from `Available models`, Provider/tool incompatibility | Do not blindly retry. Record current-session capability evidence, rerun routing, and require authorization for any changed model, Provider, backend, cost, workspace, or context. It does not mean the model does not exist. |
| Semantic or validation | contract gap, weak evidence, failed validation, out-of-scope write, partial result | Main Agent chooses bounded rework, evidence collection, independent review, revised plan, or stop. No automatic backend or model switch. |
| Authorization or boundary | read-only write, unapproved Profile, context escalation, unowned file, unapproved process/worktree | Stop the affected branch immediately, preserve only necessary evidence, report the breach, and return to the relevant discussion/consensus/authorization state. Never backfill consent. |
