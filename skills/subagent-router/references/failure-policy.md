# Failure Policy

Never silently change model, reasoning effort, permission, context level, workspace, task scope, validation, or delegation envelope. A proposed change states cause, expected effect, cost, risk, and validation impact; request a revised preview and new okok whenever it changes an authorized boundary.

## Classify and act

| Class | Examples | Required action |
|---|---|---|
| Technical temporary | interruption, network failure, rate limit, JSONL interruption, temporary service outage | Retry once with the identical model, reasoning, permission, context, workspace, task package, and envelope; record both attempts, then return failed or blocked. |
| Model or nesting | parent model cannot be identified, Luna parent attempts a spawn, requested child is outside the envelope | Stop the affected branch. Report the constraint; require a revised preview and okok if the team shape must change. |
| Semantic or validation | contract gap, weak evidence, failed validation, out-of-scope write, partial result | Main Agent chooses bounded rework, evidence collection, independent review, revised plan, or stop. |
| Authorization or boundary | write before okok, unapproved context expansion, unowned file, exceeded depth/count/concurrency | Stop the affected branch immediately, preserve only necessary evidence, report the breach, and return to the preview state. Never backfill consent. |
