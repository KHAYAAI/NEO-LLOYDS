# Model & AI Governance

> SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.

## Principle

AI is **advisory by default**. No black-box financial decisions. Phase 1
establishes the enforcement points; Phase 2 adds the models that will run
through them.

## What is enforced today

**AI output is a claim, never a fact.** Values entering the risk graph from a
model carry `sourceKind = AI_INFERRED` and are rejected unless they cite a
`modelId`, a `modelVersion` and the source data the model referenced. There is
no code path promoting a claim to a fact without an explicit, audited human
action. Consumers requiring verified inputs pass `verifiedOnly=true`, which
excludes AI-derived edges from traversal.

**Uncertainty cannot be dropped.** Every estimate carries a confidence and a
basis, including `INSUFFICIENT_DATA`. Aggregation is deliberately conservative:
combined confidence is the minimum of its inputs, never higher. Reported
precision is capped by confidence, so a low-confidence figure cannot be
presented to six significant digits.

**Every material action is audited** with actor, timestamp, decision, reason,
before/after, ontology version and — where a model contributed — model id and
version. The log is append-only, enforced by a database trigger.

**Approval bands** are defined in the domain (`LOW` → automated recommendation,
`MEDIUM` → human underwriter, `HIGH` → specialist, `EXTREME` → senior
governance), with `mayProceedWithoutHuman` true for exactly one band. Nothing in
this prototype binds a legally enforceable obligation in any case.

## Still to build

A model registry with versioned deployments and evaluation results; drift
monitoring; an override mechanism recording who overrode what and why; and
per-jurisdiction thresholds. These land with Phases 2 and 3 — see
`docs/roadmap.md`.
