'use server';

import { revalidatePath } from 'next/cache';
import type { Organisation } from '@neo-lloyds/domain';
import { apiFetch, ApiError } from '@/lib/api';

export interface ActionState {
  error?: string;
  success?: string;
}

export async function grantRole(
  organisationId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await apiFetch<{ organisation: Organisation }>(`/identity/organisations/${organisationId}/roles`, {
      method: 'POST',
      body: { role: String(formData.get('role') ?? '') },
    });
    revalidatePath(`/organisations/${organisationId}`);
    return { success: 'Role granted.' };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}

export async function setKyb(
  organisationId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await apiFetch<{ organisation: Organisation }>(`/identity/organisations/${organisationId}/kyb`, {
      method: 'POST',
      body: { status: String(formData.get('status') ?? '') },
    });
    revalidatePath(`/organisations/${organisationId}`);
    return { success: 'KYB status updated.' };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}

export interface CredentialState {
  error?: string;
  keyId?: string;
  secret?: string;
}

export async function issueCredential(
  organisationId: string,
  _prevState: CredentialState,
  formData: FormData,
): Promise<CredentialState> {
  try {
    const credential = await apiFetch<{ credential: { keyId: string; secret: string; scopes: string[] } }>(
      `/identity/organisations/${organisationId}/credentials`,
      {
        method: 'POST',
        body: {
          label: String(formData.get('label') ?? ''),
          scopes: String(formData.get('scopes') ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          subjectKind: String(formData.get('subjectKind') ?? 'SERVICE'),
        },
      },
    );
    return { keyId: credential.credential.keyId, secret: credential.credential.secret };
  } catch (error) {
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}
