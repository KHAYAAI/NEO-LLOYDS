# ADR-0006: AI output is a provenanced claim, never a fact

**Status:** Accepted · **Date:** 2026-08-13

## Context
The brief forbids AI silently fabricating data or making regulated decisions.

## Decision
AI-derived values enter the graph only as nodes/edges with
`sourceKind = AI_INFERRED`, carrying model id, model version, timestamp,
confidence and the source data referenced. Any consumer requiring verified
inputs filters on `sourceKind`; the graph API exposes that filter as a
first-class parameter. Binding decisions require a recorded human approval at
the configured threshold. There is no code path where an AI claim is promoted
to a fact without an explicit, audited human verification action.

## Consequences
+ "No black-box financial decisions" is enforced by the type system, not policy.
− AI contributions are visibly second-class, which is the intent.
