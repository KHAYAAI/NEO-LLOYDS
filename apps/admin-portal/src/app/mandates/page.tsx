import { apiFetch } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import type { MandateListItem } from '@/lib/mandate-types';
import { RevokeButton } from './revoke-button';

function formatMoney(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toLocaleString()} ${currency}`;
}

/**
 * The Mandate Control Center: every AI_AGENT mandate this organisation has
 * issued as principal, its remaining ceiling, its expiry, and a working
 * kill switch -- closing the gap flagged in docs/security-model.md and
 * the audit that prompted this page: governance for Phase 11's
 * AgentMandate system existed only at the API/database layer, with no
 * human-operable UI. GET /identity/mandates and POST
 * /identity/mandates/:id/revoke (apps/api/src/identity) are both real,
 * tested endpoints -- this page is a thin, honest view over them, not a
 * simulation of one.
 */
export default async function MandatesPage() {
  await requireCredential();
  const { mandates } = await apiFetch<{ mandates: MandateListItem[] }>('/identity/mandates');

  return (
    <PortalShell>
      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>Mandate Control Center</h2>
        <p className="nl-muted">
          Every mandate this organisation has granted to an AI agent it is the principal of.
          Revoking is immediate — <code>assertAgentMayAct</code> resolves the mandate fresh on every
          request, so a revoked agent is refused on its very next call, not eventually.
        </p>
        {mandates.length === 0 ? (
          <div className="nl-empty">No mandates issued yet.</div>
        ) : (
          <table className="nl-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Permitted actions</th>
                <th>Ceiling</th>
                <th>Expires</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mandates.map((mandate) => (
                <tr key={mandate.id}>
                  <td>
                    {mandate.agentLegalName}
                    <div className="nl-muted" style={{ fontSize: 12 }}>
                      <code>{mandate.agentOrganisationId}</code>
                    </div>
                  </td>
                  <td className="nl-muted">{mandate.permittedActions.join(', ') || 'none'}</td>
                  <td>{formatMoney(mandate.maxTransactionValueMinor, mandate.currency)}</td>
                  <td className="nl-muted">{new Date(mandate.expiresAt).toLocaleString()}</td>
                  <td>
                    <span className={`nl-badge nl-badge-${mandate.status.toLowerCase()}`}>{mandate.status}</span>
                  </td>
                  <td>
                    {mandate.status === 'ACTIVE' ? (
                      <RevokeButton mandateId={mandate.id} agentLegalName={mandate.agentLegalName} />
                    ) : null}
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
