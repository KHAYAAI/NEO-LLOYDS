import Link from 'next/link';
import type { Organisation } from '@neo-lloyds/domain';
import { apiFetch } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import { CreateOrgForm } from './create-org-form';

export default async function DashboardPage() {
  await requireCredential();
  const { organisations } = await apiFetch<{ organisations: Organisation[] }>('/identity/organisations');

  return (
    <PortalShell>
      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>Create organisation</h2>
        <CreateOrgForm />
      </div>

      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>Organisations</h2>
        {organisations.length === 0 ? (
          <div className="nl-empty">None yet.</div>
        ) : (
          <table className="nl-table">
            <thead>
              <tr>
                <th>Legal name</th>
                <th>Kind</th>
                <th>Jurisdiction</th>
                <th>KYB</th>
                <th>Roles</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {organisations.map((org) => (
                <tr key={org.id}>
                  <td>{org.legalName}</td>
                  <td>{org.kind}</td>
                  <td>{org.jurisdiction}</td>
                  <td>{org.kybStatus}</td>
                  <td className="nl-muted">{org.roles.join(', ') || '—'}</td>
                  <td>
                    <Link href={`/organisations/${org.id}`}>Manage →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PortalShell>
  );
}
