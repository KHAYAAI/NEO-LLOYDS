import { apiFetch, ApiError } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import type { Claim, ClaimPayout } from '@/lib/types';
import { EvidenceForm } from './evidence-form';

export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCredential();
  const { id } = await params;

  const { claim } = await apiFetch<{ claim: Claim }>(`/claims/${id}`);

  let payouts: ClaimPayout[] = [];
  try {
    ({ payouts } = await apiFetch<{ payouts: ClaimPayout[] }>(`/claims/${id}/payouts`));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }

  return (
    <PortalShell>
      <div className="nl-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Claim {claim.id}</h2>
          <span className="nl-badge">{claim.status}</span>
        </div>
        <p className="nl-muted">
          Syndication <code>{claim.syndicationId}</code> · risk <code>{claim.riskId}</code>
        </p>
        <p>{claim.incidentDescription}</p>
        {claim.claimedLoss ? (
          <p className="nl-muted">
            Claimed loss: {(claim.claimedLoss.amountMinor / 100).toLocaleString()} {claim.claimedLoss.currency}
            {claim.reviewDecision ? ` — review: ${claim.reviewDecision}` : ''}
          </p>
        ) : null}
        {claim.approvalDecision ? (
          <p className="nl-muted">
            {claim.approvalDecision} — {claim.approvalReason}
          </p>
        ) : null}
        {claim.settledAt ? <p className="nl-muted">Settled {new Date(claim.settledAt).toLocaleString()}.</p> : null}
      </div>

      <div className="nl-panel">
        <h3 style={{ marginTop: 0 }}>Evidence</h3>
        {claim.evidenceRefs.length === 0 ? (
          <p className="nl-muted">No evidence attached yet.</p>
        ) : (
          <ul>
            {claim.evidenceRefs.map((ref, i) => (
              <li key={i}>
                <code>{ref}</code>
              </li>
            ))}
          </ul>
        )}
        <EvidenceForm claimId={claim.id} />
      </div>

      <div className="nl-panel">
        <h3 style={{ marginTop: 0 }}>Payouts</h3>
        <p className="nl-muted">Each capital provider&rsquo;s exact share of an approved claim.</p>
        {payouts.length === 0 ? (
          <div className="nl-empty">No payouts recorded yet.</div>
        ) : (
          <table className="nl-table">
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.organisationId}>
                  <td>{p.organisationId}</td>
                  <td>
                    {(p.amount.amountMinor / 100).toLocaleString()} {p.amount.currency}
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
