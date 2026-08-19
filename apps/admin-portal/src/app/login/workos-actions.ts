'use server';

import { redirect } from 'next/navigation';
import { getSignInUrl } from '@workos-inc/authkit-nextjs';

/**
 * getSignInUrl() sets a PKCE cookie internally, so it must run in a Server
 * Action or Route Handler — never during a Server Component's render (see
 * apps/admin-portal/README.md and the workos/skills authkit-nextjs guide).
 */
export async function signInWithWorkos(): Promise<void> {
  const url = await getSignInUrl({ organizationId: process.env.WORKOS_ORGANIZATION_ID });
  redirect(url);
}
