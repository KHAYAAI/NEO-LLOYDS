import type { AuditRecord } from '@neo-lloyds/domain';
import { apiFetch } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';

export default async function AuditPage() {
  await requireCredential();
  const { records } = await apiFetch<{ records: AuditRecord[] }>('/identity/audit?limit=100');

  return (
    <PortalShell>
      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>Audit log</h2>
        <p className="nl-muted">
          Append-only, newest first. A <code>REGULATOR</code> credential sees across every
          organisation; anyone else sees only their own.
        </p>
        {records.length === 0 ? (
          <div className="nl-empty">No audit records yet.</div>
        ) : (
          <table className="nl-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Subject</th>
                <th>Decision</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td className="nl-muted">{new Date(record.at).toLocaleString()}</td>
                  <td>{record.action}</td>
                  <td className="nl-muted">
                    {record.subjectType} <code>{record.subjectId}</code>
                  </td>
                  <td>
                    <span className={record.decision === 'ALLOWED' ? 'nl-badge nl-badge-open' : 'nl-badge'}>
                      {record.decision}
                    </span>
                  </td>
                  <td className="nl-muted">{record.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PortalShell>
  );
}
