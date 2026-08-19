import Link from 'next/link';
import { logout } from '@/lib/logout';

export function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="nl-shell">
      <div className="nl-header">
        <h1>
          <Link href="/dashboard" style={{ color: 'inherit', textDecoration: 'none' }}>
            Neo-Lloyds Claims Administrator Portal
          </Link>
        </h1>
        <form action={logout}>
          <button className="nl-button nl-button-secondary" type="submit">
            Sign out
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
