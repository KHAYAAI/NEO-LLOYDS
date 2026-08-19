'use server';

import { redirect } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { setCredential } from '@/lib/session';

export interface LoginState {
  error?: string;
}

/**
 * Same pattern as the broker portal (apps/broker-portal/src/app/login/actions.ts):
 * no separate login system, just a real call against the API to prove the
 * pasted credential actually works. Deliberately not `GET /capital/exposure`
 * — that 404s for a real, valid CAPITAL_PROVIDER credential with no
 * commitment recorded yet, which is a legitimate not-yet-onboarded state,
 * not proof of an invalid credential. `GET /marketplace/listings` requires
 * only `marketplace:read` and never depends on the caller's own business
 * state, so a 401/403 from it means the credential itself is the problem.
 */
export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const credential = String(formData.get('credential') ?? '').trim();
  if (!credential.includes('.')) {
    return { error: 'Expected a credential in the form <keyId>.<secret>' };
  }

  try {
    await apiFetch('/marketplace/listings', { credential });
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: `Could not authenticate: ${error.message} (HTTP ${error.status})` };
    }
    return { error: 'Could not reach the Neo-Lloyds API. Is it running?' };
  }

  await setCredential(credential);
  redirect('/dashboard');
}
