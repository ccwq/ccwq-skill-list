# Worker Contract

Send only the minimum necessary package—never credentials, an entire unrelated conversation, or unnecessary project material. Use node scripts/validate-worker-contract.mjs --kind input <file> and --kind result --type <research|review|write|batch> <file> for deterministic checks.

## Input

~~~json
{
  "task_id": "unique-id",
  "goal": "single bounded outcome",
  "parent_model": "terra",
  "model": "luna",
  "reasoning_effort": "low",
  "spawn_depth": 1,
  "permission": "read",
  "context_level": "minimal",
  "workspace": "authorized workspace",
  "allowed_scope": ["allowed path or operation"],
  "forbidden_actions": ["explicit prohibition"],
  "known_facts": ["fact the worker may rely on"],
  "delegation": {
    "enabled": false,
    "allowed_child_models": [],
    "max_depth": 2,
    "max_workers": 5,
    "max_concurrency": 2
  },
  "output_contract": "research",
  "acceptance_criteria": ["observable completion test"],
  "failure_contract": "return blockers, failures, and missing inputs"
}
~~~

parent_model and model are luna, terra, or sol. A Luna parent is invalid because it cannot create a child. A Luna Worker must set delegation.enabled to false with an empty allowed_child_models list. Terra and Sol may delegate only within their declared envelope.

## Base result

~~~json
{
  "status": "completed",
  "task_id": "unique-id",
  "parent_model": "terra",
  "model": "luna",
  "reasoning_effort": "low",
  "spawn_depth": 1,
  "permission": "read",
  "context_level": "minimal",
  "workspace": "actual workspace or unverified",
  "scope_observed": ["actual path or operation"],
  "summary": "bounded result summary",
  "evidence": ["artifact or source reference"],
  "validation": ["check and outcome"],
  "boundary_violations": [],
  "unresolved": []
}
~~~

Identity fields that cannot be proven use unverified, never a guess. completed requires the full contract, non-empty evidence and validation, and empty boundary_violations and unresolved; partial, blocked, and failed must expose their gaps.

## Type extensions

Research adds findings, confidence (high|medium|low), and unknowns. Review adds issues, each with severity (critical|high|medium|low|note), location, rationale, and recommendation. Write adds changed_files, diff_summary, validation_commands, validation_results, and rollback_reference. Batch adds item_results, failed_items, and summary_statistics; every item_results entry must be an object with its own legal completed|partial|blocked|failed status.

The main Agent independently inspects scope, diff, evidence, validation, conflicts, rollback material, and unresolved items. A Worker saying completed is not acceptance.
