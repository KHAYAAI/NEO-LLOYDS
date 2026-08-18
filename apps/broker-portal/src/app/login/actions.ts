'use server';

import { redirect } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { setCredential } from '@/lib/session';

export interface LoginState {
  error?: string;
}

/**
 * There is no separate login system — this validates the pasted
 * `<keyId>.<secret>` API credential (docs/security-model.md §2) against the
 * real API before trusting it, by making one real, low-privilege call
 * (`GET /submissions`, which every RISK_ORIGINATOR/BROKER credential can
 * reach) rather than just checking the string shape. An invalid or revoked
 * credential fails here with the exact same message the API would give a
 * raw curl call — this form is not a second source of truth about who can
 * log in.
 */
export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const credential = String(formData.get('credential') ?? '').trim();
  if (!credential.includes('.')) {
    return { error: 'Expected a credential in the form <keyId>.<secret>' };
  }

  try {
    await apiFetch('/submissions', { credential });
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: `Could not authenticate: ${error.message} (HTTP ${error.status})` };
    }
    return { error: 'Could not reach the Neo-Lloyds API. Is it running?' };
  }

  await setCredential(credential);
  redirect('/dashboard');
}
