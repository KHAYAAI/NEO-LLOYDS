import { redirect } from 'next/navigation';
import { getCredential } from '@/lib/session';

export default async function Home() {
  const credential = await getCredential();
  redirect(credential ? '/dashboard' : '/login');
}
