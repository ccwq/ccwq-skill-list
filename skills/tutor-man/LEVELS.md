# Tutor-Man Mastery Levels

These levels are an operational rubric inspired by Feynman-style learning. They measure what the learner can do with an idea, not how long or technical the explanation is.

## L1 — Recognize

**State:** “I know what this is and where it belongs.”

The learner can:
- identify the topic and its purpose,
- recognize a situation where it is relevant,
- distinguish it from a clearly different category.

**Good evidence:** choose an appropriate use case or explain the topic in one plain sentence.

**Teaching emphasis:** intuition, purpose, one representative example. Avoid implementation depth unless required to prevent a false mental model.

## L2 — Operate

**State:** “I can complete the normal path with a small amount of guidance.”

The learner can:
- follow the canonical workflow or method,
- use the core vocabulary correctly enough to act,
- recover from a simple predictable mistake with guidance.

**Good evidence:** complete, order, or adapt the canonical steps for one standard task.

**Teaching emphasis:** shortest useful path, concrete actions, minimal syntax, immediate feedback.

## L3 — Explain

**State:** “I understand why the normal path works.”

The learner can:
- explain the core mechanism in their own words,
- connect actions to consequences,
- distinguish adjacent concepts that novices commonly confuse,
- predict a simple behavior from the mental model.

**Good evidence:** teach-back, a why-question, a prediction, or a contrast with a nearby concept.

**Teaching emphasis:** causal model, plain-language explanation, one revealing example and counterexample.

## L4 — Apply & Judge

**State:** “I can use this independently when the situation changes.”

This is the default Tutor-Man target.

The learner can:
- solve a realistic task without copying a fixed recipe,
- adapt the Core Path when one condition changes,
- choose among common options and justify the choice,
- diagnose a common failure using the mental model,
- explain the important decision in simple language.

**Good evidence:** a slightly novel real-world scenario where the learner must choose, adapt, or troubleshoot and justify the decision.

**Teaching emphasis:** decision rules, failure modes, tradeoffs that matter in practice, and independent action.

## L5 — Derive & Transfer

**State:** “I can reason beyond the examples I was taught.”

The learner can:
- derive behavior in an unfamiliar case from first principles,
- identify assumptions, boundaries, and failure conditions,
- compare alternatives using explicit tradeoffs,
- transfer the mental model to a neighboring problem,
- explain where an analogy, abstraction, or rule stops working.

**Good evidence:** an unfamiliar scenario requiring derivation, architecture/method comparison, boundary analysis, or transfer.

**Teaching emphasis:** invariants, assumptions, counterexamples, alternative designs, and first-principles reasoning.

## Capability deltas

- `L1 → L2`: recognition becomes executable action.
- `L2 → L3`: action becomes causal explanation.
- `L3 → L4`: explanation becomes independent judgement under variation.
- `L4 → L5`: judgement becomes derivation, boundary awareness, and transfer.

When comparing non-adjacent levels, preserve these intermediate capability jumps but compress any step that does not change the user's decision.

## Verification quality

A mastery check is strong when it is:

- **Minimal:** one short scenario is usually enough.
- **Diagnostic:** a wrong answer reveals a specific gap.
- **Transferable:** it changes at least one surface detail from the teaching example.
- **Level-matched:** it cannot be passed by a lower-level capability alone.

Avoid trivia, vocabulary-only recall, and tests whose answer is exposed by formatting or leading language.
