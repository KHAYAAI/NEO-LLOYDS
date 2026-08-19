'use server';

import { redirect } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import type { Claim } from '@/lib/types';

export interface ReportClaimState {
  error?: string;
}

/** Reports an incident against a BOUND syndication (Phase 7). Starts REPORTED. */
export async function reportClaim(
  _prevState: ReportClaimState,
  formData: FormData,
): Promise<ReportClaimState> {
  const syndicationId = String(formData.get('syndicationId') ?? '').trim();
  const riskId = String(formData.get('riskId') ?? '').trim();
  const incidentDescription = String(formData.get('incidentDescription') ?? '').trim();

  if (!syndicationId || !riskId || !incidentDescription) {
    return { error: 'All fields are required.' };
  }

  let target: string;
  try {
    const { claim } = await apiFetch<{ claim: Claim }>('/claims', {
      method: 'POST',
      body: { syndicationId, riskId, incidentDescription },
    });
    target = `/claims/${claim.id}`;
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }

  redirect(target);
}
