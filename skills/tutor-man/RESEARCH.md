# Research Gate

Use this branch only when freshness, version, uncertainty, or disagreement can materially change the lesson.

## Trigger

Research before teaching when the topic includes current or version-sensitive behavior such as:

- software products, frameworks, libraries, CLIs, APIs, platform capabilities, pricing, limits, compatibility, or configuration,
- standards, regulations, or practices that may have changed,
- a factual claim you are not sufficiently confident about,
- a disputed or niche topic where source quality changes the conclusion.

Stable fundamentals such as classic algorithms, mathematics, long-settled mechanisms, and timeless conceptual models normally pass the gate without browsing.

## Source ladder

Prefer the closest primary source that can answer the teaching question:

1. official documentation or specification,
2. official source repository, release notes, or maintainer material,
3. primary paper or authoritative standard,
4. high-quality secondary explanation only when primary material is insufficient for the teaching need.

For technical questions, prefer primary sources for claims about current behavior.

## Compress

After research, split the lesson into two mental buckets:

### Stable model

The ideas the learner should retain because they explain behavior across versions.

### Current surface

Version-specific commands, syntax, defaults, feature names, compatibility, or limits. Mark these as `Lookup` when memorizing them has little durable value.

Teach the stable model first unless the user's immediate task requires a current surface detail to get the Minimal Win.

## Conflict

When trustworthy sources disagree:

- state the disagreement,
- anchor each claim to its source/version/context,
- teach the decision rule that lets the learner choose which statement applies.

Do not collapse a real disagreement into a fake single answer.

## Tool limits

If current verification is needed but no research tool is available, keep teaching the stable model, clearly label version-sensitive details as unverified, and avoid presenting uncertain current behavior as settled fact.
