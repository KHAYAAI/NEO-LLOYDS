import Link from 'next/link';
import { logout } from '@/lib/logout';

export function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="nl-shell">
      <div className="nl-header">
        <h1>
          <Link href="/dashboard" style={{ color: 'inherit', textDecoration: 'none' }}>
            Neo-Lloyds Admin Portal
          </Link>
        </h1>
        <nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Link href="/dashboard">Organisations</Link>
          <Link href="/audit">Audit log</Link>
          <Link href="/jurisdictions">Jurisdictions</Link>
          <form action={logout}>
            <button className="nl-button nl-button-secondary" type="submit">
              Sign out
            </button>
          </form>
        </nav>
      </div>
      {children}
    </div>
  );
}
