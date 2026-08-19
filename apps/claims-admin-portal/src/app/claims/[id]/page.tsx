import { apiFetch, ApiError } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import type { Claim, ClaimPayout } from '@/lib/types';
import { NEXT_STATUS } from './action-state';
import { AdvanceForm } from './advance-form';
import { LossForm } from './loss-form';
import { DecideForm } from './decide-form';
import { SettleForm } from './settle-form';

export default async function ClaimAdminPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCredential();
  const { id } = await params;

  const { claim } = await apiFetch<{ claim: Claim }>(`/claims/${id}`);

  let payouts: ClaimPayout[] = [];
  try {
    ({ payouts } = await apiFetch<{ payouts: ClaimPayout[] }>(`/claims/${id}/payouts`));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }

  const nextStatus = NEXT_STATUS[claim.status];

  return (
    <PortalShell>
      <div className="nl-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Claim {claim.id}</h2>
          <span className="nl-badge">{claim.status}</span>
        </div>
        <p className="nl-muted">
          Syndication <code>{claim.syndicationId}</code> · risk <code>{claim.riskId}</code> · reported by{' '}
          <code>{claim.reportedBy}</code>
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
      </div>

      <div className="nl-panel">
        <h3 style={{ marginTop: 0 }}>Workflow</h3>
        {nextStatus ? (
          <>
            <p className="nl-muted">
              REPORTED → EVIDENCE_COLLECTED → VERIFIED → COVERAGE_CONFIRMED requires the syndication to be
              BOUND for the final step.
            </p>
            <AdvanceForm claimId={claim.id} to={nextStatus} />
          </>
        ) : null}

        {claim.status === 'COVERAGE_CONFIRMED' ? (
          <>
            <p className="nl-muted" style={{ marginTop: 16 }}>
              The coverage test: checks the claimed loss against the syndication&rsquo;s bound capacity, net
              of every prior approved/settled claim, then classifies AUTO (approved and paid out
              immediately) or HUMAN_REVIEW (moves to AWAITING_APPROVAL).
            </p>
            <LossForm claimId={claim.id} />
          </>
        ) : null}

        {claim.status === 'AWAITING_APPROVAL' ? (
          <>
            <p className="nl-muted" style={{ marginTop: 16 }}>Record a human decision.</p>
            <DecideForm claimId={claim.id} />
          </>
        ) : null}

        {claim.status === 'APPROVED' ? (
          <>
            <p className="nl-muted" style={{ marginTop: 16 }}>
              Test settlement infrastructure only — see docs/reports/phase-7.md and §8 of
              docs/security-model.md for what real settlement requires.
            </p>
            <SettleForm claimId={claim.id} />
          </>
        ) : null}

        {!nextStatus &&
        claim.status !== 'COVERAGE_CONFIRMED' &&
        claim.status !== 'AWAITING_APPROVAL' &&
        claim.status !== 'APPROVED' ? (
          <p className="nl-muted">No further action available for a claim in {claim.status}.</p>
        ) : null}
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
