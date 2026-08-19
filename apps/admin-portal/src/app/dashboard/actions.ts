'use server';

import { revalidatePath } from 'next/cache';
import type { Organisation } from '@neo-lloyds/domain';
import { apiFetch, ApiError } from '@/lib/api';

export interface ActionState {
  error?: string;
  success?: string;
}

export async function createOrganisation(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { organisation } = await apiFetch<{ organisation: Organisation }>(
      '/identity/organisations',
      {
        method: 'POST',
        body: {
          legalName: String(formData.get('legalName') ?? ''),
          kind: String(formData.get('kind') ?? 'COMPANY'),
          jurisdiction: String(formData.get('jurisdiction') ?? '').toUpperCase(),
        },
      },
    );
    revalidatePath('/dashboard');
    return { success: `Created ${organisation.legalName} (${organisation.id}).` };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}
