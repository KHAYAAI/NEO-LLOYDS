'use server';

import { revalidatePath } from 'next/cache';
import type { Money } from '@neo-lloyds/domain';
import { apiFetch, ApiError } from '@/lib/api';

export interface ActionState {
  error?: string;
  success?: string;
}

export async function setCommitment(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { commitment } = await apiFetch<{ commitment: { committed: Money } }>('/capital/commitments', {
      method: 'POST',
      body: {
        committedMinor: Number(formData.get('committedMinor')),
        currency: String(formData.get('currency') ?? 'USD').toUpperCase(),
      },
    });
    revalidatePath('/exposure');
    return {
      success: `Commitment set: ${(commitment.committed.amountMinor / 100).toLocaleString()} ${commitment.committed.currency}.`,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}
