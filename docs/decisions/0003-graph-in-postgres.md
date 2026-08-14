# ADR-0003: Represent the risk graph in PostgreSQL

**Status:** Accepted · **Date:** 2026-08-13

## Context
The system needs graph traversal (dependency closure, reverse exposure,
correlation) but the brief forbids unnecessary infrastructure.

## Decision
Store nodes and edges as adjacency tables in PostgreSQL. Traverse with
recursive CTEs, with a depth bound and a visited set. Keep traversal logic in
`packages/domain` as pure functions over an in-memory subgraph so it is
identical whether the data came from Postgres or a test fixture.

## Revisit when
Traversals routinely exceed ~6 hops or ~10^5 nodes per query, or path-ranking
queries dominate. Then evaluate Apache AGE (same database) before adding Neo4j
(another system of record, another consistency problem).

## Consequences
+ One source of truth, one backup story, real transactions.
+ Graph and relational data join natively.
− Deep traversals will need index tuning and eventually materialised closures.
