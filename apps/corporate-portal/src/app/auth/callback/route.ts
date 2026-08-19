import { handleAuth } from '@workos-inc/authkit-nextjs';

/**
 * WorkOS redirects here after the hosted AuthKit sign-in completes.
 * handleAuth() exchanges the code, sets AuthKit's own session cookie, then
 * sends the browser to returnPathname — the bridge route, not directly to
 * /dashboard, because /dashboard reads Neo-Lloyds' own nl_credential
 * cookie (src/lib/session.ts), which AuthKit knows nothing about.
 */
export const GET = handleAuth({ returnPathname: '/auth/bridge' });
