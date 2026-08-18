'use server';

import { revalidatePath } from 'next/cache';
import type { RiskScore } from '@neo-lloyds/domain';
import { apiFetch, ApiError } from '@/lib/api';
import type { Listing } from '@/lib/types';
import type { ActionState } from './action-state';

export async function advanceSubmission(
  submissionId: string,
  to: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    await apiFetch(`/submissions/${submissionId}/advance`, { method: 'POST', body: { to } });
    revalidatePath(`/submissions/${submissionId}`);
    return { success: `Advanced to ${to}.` };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}

export async function scoreRisk(
  riskId: string,
  submissionId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const result = await apiFetch<{ score: RiskScore }>(`/scoring/risks/${riskId}`, {
      method: 'POST',
      body: {
        factors: [
          {
            key: 'primary',
            description: String(formData.get('factorDescription') ?? ''),
            weight: Number(formData.get('weight')),
            likelihood: Number(formData.get('likelihood')),
            confidence: Number(formData.get('confidence')),
            basis: String(formData.get('basis')),
          },
        ],
        maximumEstimatedLossMinor: Number(formData.get('maxLossMinor')),
        currency: String(formData.get('currency') ?? 'USD').toUpperCase(),
        durationDays: Number(formData.get('durationDays')),
        mitigationCoverage: Number(formData.get('mitigationCoverage')),
        correlatedRiskCount: Number(formData.get('correlatedRiskCount')),
        concentrationShare: Number(formData.get('concentrationShare')),
      },
    });
    revalidatePath(`/submissions/${submissionId}`);
    return {
      success: `Scored: probability ${result.score.probability.expected.toFixed(3)}, confidence ${result.score.confidence.toFixed(2)}.`,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}

export async function listToMarketplace(
  submissionId: string,
  riskId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { listing } = await apiFetch<{ listing: Listing }>('/marketplace/listings', {
      method: 'POST',
      body: {
        submissionId,
        riskClass: String(formData.get('riskClass') ?? ''),
        capacityMinor: Number(formData.get('capacityMinor')),
        currency: String(formData.get('currency') ?? 'USD').toUpperCase(),
        durationDays: Number(formData.get('durationDays')),
      },
    });
    revalidatePath(`/submissions/${submissionId}`);
    return { success: `Listed — listing ${listing.id} is now OPEN.` };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}
