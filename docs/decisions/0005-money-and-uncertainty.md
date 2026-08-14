# ADR-0005: Integer money and mandatory uncertainty

**Status:** Accepted · **Date:** 2026-08-13

## Context
Non-negotiable principles forbid faking financial data and outputting false
precision. Floating-point money silently loses cents at ledger scale.

## Decision
Money is `{ amountMinor: integer, currency: ISO-4217 }`. No floats, no implicit
currency, no cross-currency arithmetic without a provenanced FX rate. Risk
estimates are always paired with an explicit confidence in [0,1]; the domain
exposes no function returning a naked probability or a bare loss figure.

## Consequences
+ Exact ledger arithmetic; uncertainty is impossible to omit by accident.
+ Consumers cannot present model output as certainty without deliberate effort.
− Callers must supply confidence even for trivially certain values.
