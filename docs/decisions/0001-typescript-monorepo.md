# ADR-0001: TypeScript monorepo with a dependency-free domain package

**Status:** Accepted · **Date:** 2026-08-13

## Context
The brief mandates a TypeScript-first stack and requires every financial
calculation to be reproducible and every external data point traceable.

## Decision
One repository, npm workspaces. `packages/domain` contains all risk
mathematics, ontology rules, graph traversal and invariants as pure functions
over plain data, with **zero runtime dependencies**. NestJS, Prisma and AI
providers are adapters around it.

## Consequences
+ Domain logic is testable in milliseconds with no database or network.
+ Reproducibility is structural: same input, same output, provably.
+ Extracting a service later moves an adapter, not the domain.
− Some mapping boilerplate between persistence rows and domain types.
