import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@workos-inc/authkit-nextjs';
import { setCredential } from '@/lib/session';

/**
 * The seam between WorkOS AuthKit and Neo-Lloyds' own auth model
 * (docs/security-model.md §10). AuthKit's `accessToken` is a JWT this
 * portal forwards as the Neo-Lloyds API bearer credential, stored in the
 * exact same httpOnly `nl_credential` cookie the pasted-credential login
 * path already uses (src/lib/session.ts) — everything downstream
 * (require-session.ts, api.ts, every page/action in this portal) is
 * unchanged.
 *
 * This only works once the token is accepted by apps/api's OIDC verifier,
 * which means OIDC_ISSUER_URL/OIDC_JWKS_URL there must be set to whatever
 * WorkOS's actual AuthKit issuer/JWKS endpoint is for this environment,
 * and the subject that access token's `sub` claim carries must already be
 * linked via POST /identity/organisations/:id/oidc-users. Neither of
 * those two facts could be confirmed from this sandbox (no network access
 * to workos.com/api.workos.com) — see apps/admin-portal/README.md.
 */
export async function GET(request: NextRequest) {
  const { user, accessToken } = await withAuth();

  if (!user || !accessToken) {
    return NextResponse.redirect(new URL('/login?error=workos', request.url));
  }

  await setCredential(accessToken);
  return NextResponse.redirect(new URL('/dashboard', request.url));
}
