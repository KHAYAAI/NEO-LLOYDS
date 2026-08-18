'use server';

import { redirect } from 'next/navigation';
import type { RiskNode, RiskSubmission } from '@neo-lloyds/domain';
import { apiFetch, ApiError } from '@/lib/api';

export interface NewSubmissionState {
  error?: string;
}

/**
 * A submission needs a RISK node in the graph to point at (Phase 2), so this
 * is two API calls, not one: create the node, then the submission that
 * references it. If the second call fails, the node still exists — this
 * portal does not attempt a rollback the API itself doesn't offer.
 */
export async function createSubmission(
  _prevState: NewSubmissionState,
  formData: FormData,
): Promise<NewSubmissionState> {
  const label = String(formData.get('label') ?? '').trim();
  const jurisdiction = String(formData.get('jurisdiction') ?? '').trim().toUpperCase();
  const title = String(formData.get('title') ?? '').trim();

  if (!label) return { error: 'Risk label is required.' };
  if (!/^[A-Z]{2}$/.test(jurisdiction)) {
    return { error: 'Jurisdiction must be a two-letter ISO-3166-1 alpha-2 code (e.g. ZA) — there is no default.' };
  }
  if (!title) return { error: 'Submission title is required.' };

  // `redirect()` throws a special signal Next.js's router relies on — it
  // must never be called from inside a try/catch (even re-thrown, some
  // bundling paths can mangle it), so the happy-path target is computed
  // inside the try and the actual redirect() call happens after it.
  let target: string;
  try {
    const { node } = await apiFetch<{ node: RiskNode }>('/graph/nodes', {
      method: 'POST',
      body: {
        type: 'RISK',
        label,
        jurisdiction,
        provenance: {
          sourceId: 'broker-portal',
          sourceKind: 'USER_DECLARED',
          observedAt: new Date().toISOString(),
          confidence: 0.9,
        },
      },
    });

    const { submission } = await apiFetch<{ submission: RiskSubmission }>('/submissions', {
      method: 'POST',
      body: { riskId: node.id, title },
    });

    target = `/submissions/${submission.id}`;
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: `${error.message} (HTTP ${error.status})` };
    }
    throw error;
  }

  redirect(target);
}
