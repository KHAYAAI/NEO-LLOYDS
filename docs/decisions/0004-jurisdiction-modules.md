# ADR-0004: Jurisdiction as a module, never a default

**Status:** Accepted · **Date:** 2026-08-13

## Context
Strategic HQ is Johannesburg; the objective is a globally deployable market.
Hard-coding South African regulation would make every other market a rewrite.

## Decision
The core domain is jurisdiction-neutral. Every organisation, risk and policy
carries an explicit jurisdiction. Rules — capital treatment, KYC/AML, sanctions,
tax, data residency, cross-border — live in `packages/config/jurisdictions/<code>`
behind a `JurisdictionModule` interface. South Africa is the first
implementation, not the fallback. There is no default jurisdiction: omitting it
is a validation error.

## Consequences
+ New markets are a module, not a migration.
+ Regulatory review can inspect one directory per regulator.
− Every entity must declare a jurisdiction up front.
