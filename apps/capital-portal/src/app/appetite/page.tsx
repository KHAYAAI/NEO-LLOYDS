import type { CapitalAppetite } from '@neo-lloyds/domain';
import { apiFetch, ApiError } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import { AppetiteForm } from './appetite-form';

interface RankedMatch {
  listing: { id: string; riskClass: string; jurisdiction: string; capacity: { amountMinor: number; currency: string }; durationDays: number };
  result: { matches: boolean; reasons: readonly string[] };
}

export default async function AppetitePage() {
  await requireCredential();

  let appetite: CapitalAppetite | undefined;
  try {
    ({ appetite } = await apiFetch<{ appetite: CapitalAppetite }>('/marketplace/appetite'));
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }

  let matches: RankedMatch[] = [];
  if (appetite) {
    ({ matches } = await apiFetch<{ matches: RankedMatch[] }>('/marketplace/appetite/matches'));
  }

  return (
    <PortalShell>
      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>Capital appetite</h2>
        <p className="nl-muted">
          Declares what this organisation is willing to back — matching (Phase 4) is deterministic
          and every non-match states its exact reasons, never a silent &ldquo;no&rdquo;.
        </p>
        {appetite ? (
          <p className="nl-muted">
            Currently set: {appetite.preferredRiskClasses.join(', ')} in{' '}
            {appetite.preferredJurisdictions.join(', ')}, up to{' '}
            {(appetite.maxExposure.amountMinor / 100).toLocaleString()} {appetite.maxExposure.currency},{' '}
            {appetite.riskTolerance.toLowerCase()} tolerance.
          </p>
        ) : (
          <p className="nl-muted">No appetite profile set yet.</p>
        )}
        <AppetiteForm />
      </div>

      {appetite ? (
        <div className="nl-panel">
          <h3 style={{ marginTop: 0 }}>Ranked matches against your appetite</h3>
          {matches.length === 0 ? (
            <div className="nl-empty">No open listings to rank.</div>
          ) : (
            <table className="nl-table">
              <thead>
                <tr>
                  <th>Risk class</th>
                  <th>Jurisdiction</th>
                  <th>Capacity</th>
                  <th>Match</th>
                  <th>Reasons</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={m.listing.id}>
                    <td>{m.listing.riskClass}</td>
                    <td>{m.listing.jurisdiction}</td>
                    <td>
                      {(m.listing.capacity.amountMinor / 100).toLocaleString()} {m.listing.capacity.currency}
                    </td>
                    <td>{m.result.matches ? '✓' : '✗'}</td>
                    <td className="nl-muted">{m.result.reasons.join('; ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </PortalShell>
  );
}
