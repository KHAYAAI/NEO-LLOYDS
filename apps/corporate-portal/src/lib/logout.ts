'use server';

import { redirect } from 'next/navigation';
import { clearCredential } from './session';

export async function logout(): Promise<void> {
  await clearCredential();
  redirect('/login');
}
