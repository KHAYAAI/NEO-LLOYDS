'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiError } from '@/lib/api';

export interface ActionState {
  error?: string;
  success?: string;
}

/**
 * The kill switch's actual trigger: POST /identity/mandates/:id/revoke
 * (apps/api/src/identity/identity.controller.ts), enforced server-side by
 * IdentityService.revokeMandate -- only the principal organisation may
 * call it, and it takes effect on the agent's very next request (see
 * assertAgentMayAct's doc comment). This action does not simulate
 * anything client-side; the button either reaches that real endpoint or
 * the state shows the real error.
 */
export async function revokeMandate(mandateId: string, _prevState: ActionState): Promise<ActionState> {
  try {
    await apiFetch(`/identity/mandates/${mandateId}/revoke`, { method: 'POST' });
    revalidatePath('/mandates');
    return { success: `Mandate ${mandateId} revoked.` };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}
