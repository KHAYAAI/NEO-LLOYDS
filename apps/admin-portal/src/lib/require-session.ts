import { redirect } from 'next/navigation';
import { getCredential } from './session';

/** Every authenticated page starts with this — no credential, no page. */
export async function requireCredential(): Promise<string> {
  const credential = await getCredential();
  if (!credential) redirect('/login');
  return credential;
}
