import Link from 'next/link';
import type { RiskSubmission } from '@neo-lloyds/domain';
import { apiFetch } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import { StatusBadge } from '@/components/status-badge';

export default async function DashboardPage() {
  await requireCredential();
  const { submissions } = await apiFetch<{ submissions: RiskSubmission[] }>('/submissions');

  const sorted = [...submissions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <PortalShell>
      <div className="nl-actions" style={{ marginBottom: 16, justifyContent: 'flex-end' }}>
        <Link href="/submissions/new" className="nl-button">
          New submission
        </Link>
      </div>

      <div className="nl-panel">
        {sorted.length === 0 ? (
          <div className="nl-empty">No submissions yet. Start one from a risk in the graph.</div>
        ) : (
          <table className="nl-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((submission) => (
                <tr key={submission.id}>
                  <td>{submission.title}</td>
                  <td>
                    <StatusBadge status={submission.status} />
                  </td>
                  <td className="nl-muted">{new Date(submission.createdAt).toLocaleString()}</td>
                  <td>
                    <Link href={`/submissions/${submission.id}`}>View →</Link>
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
