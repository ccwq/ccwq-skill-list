# Grilling Protocol

Use only for -g, --grilling, -gl, -gt, or -gs.

## Read-only discussion

Begin with complexity, known information gaps, an adjustable estimated question total, recommended read-only investigation, and 第 1/[total] 个问题. Verify low-cost facts through files, tools, environment inspection, and authoritative sources. Investigation authorization covers only the stated read-only verification; it never authorizes execution.

Ask exactly one high-information decision question per turn. State relevant dependencies, answer directions, the recommended answer, rationale, and its principal cost or limitation. Prefer the path: objective, current state, obstacle, root cause, assumptions, tradeoffs, risks, acceptance, then boundary. Update the estimate when evidence changes it.

Do not create a Worker, worktree, process, file, installation, deployment, or other state change during discussion. If a proposed investigation changes cost, risk, scope, or execution path, request distinct investigation authorization first.

## One preview and one authorization

When the objective, success criteria, constraints, tradeoffs, risks, validation, action boundary, model strategy, workspace boundary, and dependencies are clear, summarize:

当前共识 | 关键决策 | 依赖风险 | 验收标准 | 剩余未决

Then present the concise execution preview. By default, wait for one exact user message: okok. It must be the standalone normalized message defined in [the main Skill](../SKILL.md); no discussion phrase authorizes execution. When `-f/--fast` is set, skip this confirmation wait and proceed immediately, while retaining the same scope, permission, validation, and delegation-envelope checks.

After okok, or immediately in fast mode, create only the Workers and writes in that preview. A material plan change invalidates the preview; in normal mode present a revised preview and wait for a new okok, while fast mode must stop and recompute the plan before proceeding.
