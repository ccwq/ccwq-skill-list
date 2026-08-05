# Extended discussion protocol

Use this reference only when the core authorization gate in `SKILL.md` requires a new or resumed discussion. The state transitions and exact phrases in `SKILL.md` are authoritative; this file defines how to reach consensus predictably.

## First response

For a new operational request, state:

- complexity;
- material information gaps;
- estimated discussion rounds;
- whether direct continuation, quick verification, or full investigation is appropriate;
- exactly one question numbered `第 n/[total] 问`.

## Question loop

Ask one decision question per round. Prefer the question with the highest information gain along this path:

`目标 → 现状 → 障碍 → 根因 → 假设 → 取舍 → 风险 → 验收 → 边界`

Each question contains:

- answer directions;
- a recommended answer;
- the reason for that recommendation;
- its trade-offs or limitations.

Verify low-cost facts directly. Ask the user only for goals, preferences, priority, risk tolerance, and consequential trade-offs. Update the question order and estimated round count when new evidence changes the decision tree.

**Discussion is complete when:** the real goal, success criteria, constraints, core trade-offs, main risks, verification method, and execution boundary are explicit.

## Consensus and planning

Summarize:

- current consensus;
- key decisions;
- dependencies and risks;
- acceptance criteria;
- remaining unresolved items.

When no major unresolved item remains, request the exact consensus phrase defined in `SKILL.md`. After receiving it, provide a bounded implementation plan and request the exact execution phrase defined there. Do not combine the two requests or accept approximate wording.

**Planning is complete when:** the plan maps each authorized action to a verification step and no action exceeds the agreed boundary.

## Investigation and staged work

Read-only investigation may continue within an agreed stage. Request fresh agreement when scope, cost, risk, or path materially changes.

When later work depends on an intermediate result, explain the reason for staging, expected benefit, and main cost; let the user choose whether to stage. During authorized execution, use the loop:

`执行一步 → 核验结果 → 更新判断 → 决定下一步`

Staging agreement and investigation agreement do not grant write authorization.

## Rollback

When a premise proves false, the goal becomes ambiguous, a definition fails, or an assumption is overturned:

1. pause the affected branch;
2. state the invalidated premise and evidence;
3. return to the decision node that depended on it;
4. reorder the remaining questions.

**Rollback is complete when:** the active branch again rests on explicit, valid premises.
