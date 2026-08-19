import { cookies } from 'next/headers';

/**
 * The portal reuses the existing API-key auth (docs/security-model.md §2) —
 * there is no separate login system. The pasted `<keyId>.<secret>` credential
 * is held only in an httpOnly, server-only cookie: it is set by a Route
 * Handler (`app/api/session/route.ts`) and read only from Server Components/
 * Server Actions (`getCredential`) — it is never sent to the browser as
 * readable JS, and the raw secret leaves the client exactly once, over the
 * login form submission.
 */
const SESSION_COOKIE = 'nl_credential';

export async function getCredential(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

export async function setCredential(credential: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, credential, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Matches nothing about the underlying API credential's own expiry —
    // this is just how long the browser holds the session before asking
    // the broker to re-paste it. A revoked API credential still stops
    // working immediately server-side regardless of this cookie's age.
    maxAge: 60 * 60 * 8,
  });
}

export async function clearCredential(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
