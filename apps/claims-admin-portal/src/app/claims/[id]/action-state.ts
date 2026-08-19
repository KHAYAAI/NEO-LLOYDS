/**
 * `'use server'` files (./actions.ts) may only export async functions, so
 * this plain-value lookup table lives in its own module — same convention
 * discovered while building the other three portals.
 */
export const NEXT_STATUS: Record<string, string> = {
  REPORTED: 'EVIDENCE_COLLECTED',
  EVIDENCE_COLLECTED: 'VERIFIED',
  VERIFIED: 'COVERAGE_CONFIRMED',
};
