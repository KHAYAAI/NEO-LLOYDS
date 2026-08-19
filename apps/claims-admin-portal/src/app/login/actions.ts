'use server';

import { redirect } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { setCredential } from '@/lib/session';

export interface LoginState {
  error?: string;
}

/**
 * Every claims read/list endpoint requires a resource id and 404s for one
 * that doesn't exist (apps/capital-portal hit this same class of bug with
 * GET /capital/exposure — see its README). Rather than pick an unrelated
 * endpoint just because it happens not to 404, this validates against a
 * syntactically-plausible but certainly-absent syndication id and reads the
 * *class* of error: 401/403 means the credential or its claims:read scope
 * is invalid; 404 means auth passed and the guard let the request through
 * to business logic that correctly found nothing.
 */
export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const credential = String(formData.get('credential') ?? '').trim();
  if (!credential.includes('.')) {
    return { error: 'Expected a credential in the form <keyId>.<secret>' };
  }

  try {
    await apiFetch('/claims/by-syndication/00000000-0000-0000-0000-000000000000', { credential });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        // Authenticated fine; the probe syndication just doesn't exist.
      } else {
        return { error: `Could not authenticate: ${error.message} (HTTP ${error.status})` };
      }
    } else {
      return { error: 'Could not reach the Neo-Lloyds API. Is it running?' };
    }
  }

  await setCredential(credential);
  redirect('/dashboard');
}
