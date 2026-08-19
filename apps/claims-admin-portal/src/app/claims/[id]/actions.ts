'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiError } from '@/lib/api';
import type { Claim } from '@/lib/types';

export interface ActionState {
  error?: string;
  success?: string;
}

export async function advance(claimId: string, _prevState: ActionState, formData: FormData): Promise<ActionState> {
  const to = String(formData.get('to') ?? '').trim();
  if (!to) return { error: 'Target status is required.' };

  try {
    await apiFetch<{ claim: Claim }>(`/claims/${claimId}/advance`, { method: 'POST', body: { to } });
    revalidatePath(`/claims/${claimId}`);
    return { success: `Advanced to ${to}.` };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}

export async function calculateLoss(
  claimId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const amount = Number(formData.get('claimedLossAmount'));
  const currency = String(formData.get('currency') ?? '').trim().toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Claimed loss amount must be a positive number.' };
  if (currency.length !== 3) return { error: 'Currency must be a 3-letter ISO-4217 code.' };

  try {
    await apiFetch<{ claim: Claim }>(`/claims/${claimId}/loss`, {
      method: 'POST',
      body: { claimedLossMinor: Math.round(amount * 100), currency },
    });
    revalidatePath(`/claims/${claimId}`);
    return { success: 'Loss calculated — coverage test applied.' };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}

export async function decide(claimId: string, _prevState: ActionState, formData: FormData): Promise<ActionState> {
  const decision = String(formData.get('decision') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (decision !== 'APPROVED' && decision !== 'REJECTED') return { error: 'Decision must be approved or rejected.' };
  if (!reason) return { error: 'A reason is required.' };

  try {
    await apiFetch<{ claim: Claim }>(`/claims/${claimId}/decide`, { method: 'POST', body: { decision, reason } });
    revalidatePath(`/claims/${claimId}`);
    return { success: `Recorded: ${decision}.` };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}

export async function settle(claimId: string, _prevState: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    await apiFetch<{ claim: Claim }>(`/claims/${claimId}/settle`, { method: 'POST' });
    revalidatePath(`/claims/${claimId}`);
    return { success: 'Settled — see docs/reports/phase-7.md; this is test settlement infrastructure only.' };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}
