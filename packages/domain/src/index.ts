/**
 * Neo-Lloyds domain core.
 *
 * SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.
 *
 * This package has zero runtime dependencies by design (ADR-0001): every risk
 * calculation, ontology rule and authorisation check here is a pure function
 * over plain data, and is therefore reproducible and testable without any
 * infrastructure.
 */
export const SIMULATION_NOTICE =
  'SIMULATION / TEST ENVIRONMENT — NOT INSURANCE. Neo-Lloyds is a technology prototype. Nothing here is a contract of insurance, financial advice, or a regulated offer.';

export * from './errors.js';
export * from './money.js';
export * from './uncertainty.js';
export * from './provenance.js';
export * from './ontology.js';
export * from './graph.js';
export * from './queries.js';
export * from './identity.js';
export * from './audit.js';
export * from './scoring.js';
export * from './analyst.js';
export * from './submission.js';
export * from './underwriting.js';
export * from './marketplace.js';
export * from './syndication.js';
export * from './capital-ledger.js';
