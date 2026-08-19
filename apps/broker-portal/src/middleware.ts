import { authkitMiddleware } from '@workos-inc/authkit-nextjs';

/**
 * Only runs AuthKit's session-refresh/callback handling on the WorkOS
 * callback path. This portal keeps its existing paste-a-credential login
 * (src/app/login) as the primary path — WorkOS/AuthKit is offered
 * alongside it, not in place of it, and every other route is still gated
 * by requireCredential() reading the existing nl_credential cookie
 * (src/lib/require-session.ts), unchanged. See
 * src/app/auth/bridge/route.ts for how a successful WorkOS sign-in is
 * turned into that same cookie.
 */
export default authkitMiddleware();

export const config = { matcher: ['/auth/callback'] };
