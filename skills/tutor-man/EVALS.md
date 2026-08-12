# Tutor-Man Acceptance Evals

Development-only cases for checking the skill. This file is not required during normal tutoring.

## E1 — Default level + broad tool

**Prompt:** `tutor-man Docker`

Expect:
- defaults to L4,
- begins with one explanatory paragraph,
- shows a short workflow Core Path,
- chooses 3–5 useful facets,
- does not force an upfront scope interview,
- starts a useful default branch,
- ends L4 teaching with a lightweight independent-judgement check unless skipped.

Fail if: it becomes a Docker encyclopedia or defines L4 as “advanced details.”

## E2 — L1 compression

**Prompt:** `tutor-man L1 Kubernetes`

Expect:
- recognition and purpose dominate,
- no deep cluster internals unless needed to prevent a false model,
- completion can happen quickly.

Fail if: L1 merely means “same tutorial but shorter.”

## E3 — L2 tool operation

**Prompt:** `tutor-man L2 uv 创建一个 Python 项目`

Expect:
- Research Gate checks current official usage when research is available,
- shortest working path dominates,
- version-specific flags are treated as Lookup,
- no unnecessary architecture lecture.

## E4 — L3 concept

**Prompt:** `tutor-man L3 CAP theorem`

Expect:
- mechanism chain, not a fake operational workflow,
- simple causal model,
- one teach-back/prediction/contrast check.

## E5 — Hybrid method/concept

**Prompt:** `tutor-man L4 动态规划`

Expect:
- recognizes Method/Concept hybrid,
- Core Path resembles a decision/problem-solving path,
- facets emphasize state design, transition reasoning, applicability, and failure patterns,
- verification requires adapting to a slightly changed problem.

## E6 — Compare levels out of order

**Prompt:** `tutor-man L5+L3 Git rebase`

Expect:
- normalizes to L3 baseline → L5 delta,
- does not repeat two full tutorials,
- explicitly shows new L5 abilities such as boundary/tradeoff/derivation where relevant.

## E7 — Gap mode

**Prompt:** `我 Git rebase 大概 L3，距离 L5 还差什么？`

Expect:
- capability gap diagnosis,
- no replay of generic Git teaching,
- concrete upgrade evidence.

## E8 — Research Gate positive

**Prompt:** `tutor-man React`

Expect:
- current/versioned aspects are verified from official or primary sources when research is available,
- stable component/state/data-flow model is separated from current APIs and defaults.

## E9 — Research Gate negative

**Prompt:** `tutor-man 二叉树`

Expect:
- does not browse merely for ceremony when foundational facts are stable and known,
- begins teaching immediately.

## E10 — Repair loop

**Scenario:** During L4 verification, the learner gives a fluent answer but applies the wrong decision rule.

Expect:
- identifies one specific gap,
- reteaches only that gap using a new angle,
- gives one fresh check,
- does not restart the whole lesson.

## E11 — Pace override

**Prompt:** `tutor-man L4 tmux，一步一步带我做`

Expect:
- gives compact map first,
- then stops after each meaningful action and waits,
- does not dump the whole tutorial.

## E12 — Tiny topic

**Prompt:** `tutor-man L3 Python 的 defaultdict`

Expect:
- compact explanation, short mechanism/core path, 2–3 facets if enough,
- can finish in one response plus one lightweight check,
- no artificial multi-session course structure.
