import type { CapitalPosition, ConcentrationBucket, Money } from '@neo-lloyds/domain';
import { apiFetch, ApiError } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import { CommitmentForm } from './commitment-form';

function formatMoney(m: Money): string {
  return `${(m.amountMinor / 100).toLocaleString()} ${m.currency}`;
}

export default async function ExposurePage() {
  await requireCredential();

  // GET /capital/exposure 404s (via getCommitment) until this organisation
  // has set a committed-capital ceiling at least once — a legitimate
  // not-yet-onboarded state, not an error, so it is handled explicitly
  // rather than surfacing as an unhandled exception.
  let position: CapitalPosition | undefined;
  let buckets: ConcentrationBucket[] = [];
  try {
    ({ position } = await apiFetch<{ position: CapitalPosition }>('/capital/exposure'));
    ({ buckets } = await apiFetch<{ buckets: ConcentrationBucket[] }>('/capital/concentration?by=riskClass'));
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }

  if (!position) {
    return (
      <PortalShell>
        <div className="nl-panel">
          <h2 style={{ marginTop: 0 }}>Exposure</h2>
          <p className="nl-muted">
            No committed-capital ceiling has been set for this organisation yet — set one to see
            exposure computed against it.
          </p>
          <CommitmentForm />
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>Exposure</h2>
        <p className="nl-muted">
          Computed live across every syndication this organisation participates in (Phase 6) —
          not cached, not per-listing.
        </p>
        <table className="nl-table">
          <tbody>
            <tr>
              <th>Committed</th>
              <td>{formatMoney(position.committed)}</td>
            </tr>
            <tr>
              <th>Allocated (BOUND — genuinely at risk)</th>
              <td>{formatMoney(position.allocated)}</td>
            </tr>
            <tr>
              <th>Reserved (OPEN — a soft hold)</th>
              <td>{formatMoney(position.reserved)}</td>
            </tr>
            <tr>
              <th>Available</th>
              <td>{formatMoney(position.available)}</td>
            </tr>
            <tr>
              <th>Utilisation</th>
              <td>{(position.utilisationBps / 100).toFixed(2)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="nl-panel">
        <h3 style={{ marginTop: 0 }}>Concentration by risk class</h3>
        <p className="nl-muted">
          Industry, event, and asset concentration are not yet computable — the risk graph does
          not carry those as structured listing attributes (docs/reports/phase-6.md).
        </p>
        {buckets.length === 0 ? (
          <div className="nl-empty">No exposure yet.</div>
        ) : (
          <table className="nl-table">
            <thead>
              <tr>
                <th>Risk class</th>
                <th>Amount</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.key}>
                  <td>{b.key}</td>
                  <td>{formatMoney(b.amount)}</td>
                  <td>{(b.shareBps / 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PortalShell>
  );
}
