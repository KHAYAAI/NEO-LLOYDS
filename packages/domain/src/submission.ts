import { DomainError } from './errors.js';

/**
 * A Risk Package: what a broker or risk originator submits into the
 * marketplace pipeline (brief §8). Phase 2 defines the shape and the state
 * machine; underwriting and listing consume it in Phase 3–4.
 */
export const SUBMISSION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'ANALYSING',
  'SCORED',
  'READY_FOR_UNDERWRITING',
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Legal transitions. A submission never moves backward. */
const TRANSITIONS: Readonly<Record<SubmissionStatus, readonly SubmissionStatus[]>> =
  Object.freeze({
    DRAFT: ['SUBMITTED'],
    SUBMITTED: ['ANALYSING'],
    ANALYSING: ['SCORED'],
    SCORED: ['READY_FOR_UNDERWRITING'],
    READY_FOR_UNDERWRITING: [],
  });

export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function requireTransition(from: SubmissionStatus, to: SubmissionStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError(
      `A risk submission cannot move from ${from} to ${to}`,
      'INVALID_SUBMISSION_TRANSITION',
      { from, to },
    );
  }
}

export interface RiskSubmission {
  readonly id: string;
  readonly organisationId: string;
  readonly riskId: string;
  readonly title: string;
  readonly status: SubmissionStatus;
  readonly submittedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
