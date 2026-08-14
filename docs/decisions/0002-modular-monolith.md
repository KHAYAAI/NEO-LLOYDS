# ADR-0002: Modular monolith before microservices

**Status:** Accepted · **Date:** 2026-08-13

## Context
The brief names eleven services. Capital allocation, syndication and settlement
must not lose transactional integrity — an over-allocated syndicate or a
double-paid claim is a correctness failure, not a performance one.

## Decision
Ship one deployable API composed of independent NestJS modules with enforced
package boundaries. Keep module boundaries strict; defer process boundaries.

## Alternatives
Eleven services from day one — rejected: distributed transactions across the
capital ledger, plus eleven deployment pipelines, for scaling we do not need.

## Consequences
+ Single transaction across allocation and ledger writes.
+ One local `docker compose up`.
− Requires discipline: cross-module access goes through published interfaces,
  never through another module's repository.
