'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiError } from '@/lib/api';
import type { Claim } from '@/lib/types';

export interface ActionState {
  error?: string;
  success?: string;
}

export async function addEvidence(
  claimId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const evidenceRef = String(formData.get('evidenceRef') ?? '').trim();
  if (!evidenceRef) return { error: 'Evidence reference is required.' };

  try {
    await apiFetch<{ claim: Claim }>(`/claims/${claimId}/evidence`, {
      method: 'POST',
      body: { evidenceRef },
    });
    revalidatePath(`/claims/${claimId}`);
    return { success: 'Evidence attached.' };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}
