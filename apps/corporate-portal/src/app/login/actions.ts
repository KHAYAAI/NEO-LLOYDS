'use server';

import { redirect } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { setCredential } from '@/lib/session';

export interface LoginState {
  error?: string;
}

/** Same pattern as apps/broker-portal/src/app/login/actions.ts. */
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
