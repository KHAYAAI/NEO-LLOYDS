'use server';

import { revalidatePath } from 'next/cache';
import type { CapitalAppetite } from '@neo-lloyds/domain';
import { apiFetch, ApiError } from '@/lib/api';

export interface ActionState {
  error?: string;
  success?: string;
}

export async function setAppetite(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await apiFetch<{ appetite: CapitalAppetite }>('/marketplace/appetite', {
      method: 'POST',
      body: {
        preferredRiskClasses: String(formData.get('preferredRiskClasses') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        maxExposureMinor: Number(formData.get('maxExposureMinor')),
        currency: String(formData.get('currency') ?? 'USD').toUpperCase(),
        preferredJurisdictions: String(formData.get('preferredJurisdictions') ?? '')
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
        minimumReturnBps: Number(formData.get('minimumReturnBps')),
        maxDurationDays: Number(formData.get('maxDurationDays')),
        riskTolerance: String(formData.get('riskTolerance')),
        concentrationLimitBps: Number(formData.get('concentrationLimitBps')),
      },
    });
    revalidatePath('/appetite');
    return { success: 'Appetite saved.' };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}
