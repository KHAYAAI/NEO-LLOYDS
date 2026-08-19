'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiError } from '@/lib/api';
import type { Interest } from '@/lib/types';

export interface ActionState {
  error?: string;
  success?: string;
}

export async function expressInterest(
  listingId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { interest } = await apiFetch<{ interest: Interest }>(
      `/marketplace/listings/${listingId}/interest`,
      {
        method: 'POST',
        body: {
          indicativeAmountMinor: Number(formData.get('indicativeAmountMinor')),
          currency: String(formData.get('currency') ?? 'USD').toUpperCase(),
          note: String(formData.get('note') ?? '') || undefined,
        },
      },
    );
    revalidatePath('/dashboard');
    return {
      success: `Indicative interest of ${interest.indicativeAmount.amountMinor} ${interest.indicativeAmount.currency} recorded — non-binding.`,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}

export async function withdrawInterest(listingId: string): Promise<ActionState> {
  try {
    await apiFetch(`/marketplace/listings/${listingId}/interest`, { method: 'DELETE' });
    revalidatePath('/dashboard');
    return { success: 'Interest withdrawn.' };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}
