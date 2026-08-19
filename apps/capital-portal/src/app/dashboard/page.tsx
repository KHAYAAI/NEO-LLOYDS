import type { Money } from '@neo-lloyds/domain';
import { apiFetch } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import type { Listing } from '@/lib/types';
import { InterestForm } from './interest-form';

function formatMoney(m: Money): string {
  return `${(m.amountMinor / 100).toLocaleString()} ${m.currency}`;
}

export default async function DashboardPage() {
  await requireCredential();
  const { listings } = await apiFetch<{ listings: Listing[] }>('/marketplace/listings');
  const open = listings.filter((l) => l.status === 'OPEN');

  return (
    <PortalShell>
      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>Open listings</h2>
        <p className="nl-muted">
          Express non-binding indicative interest (Phase 4). Syndication (Phase 5) is what turns
          interest into a binding allocation — not this screen.
        </p>
        {open.length === 0 ? (
          <div className="nl-empty">No open listings right now.</div>
        ) : (
          open.map((listing) => (
            <div key={listing.id} className="nl-panel" style={{ background: 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong>{listing.title}</strong>
                <span className="nl-badge nl-badge-open">{listing.status}</span>
              </div>
              <p className="nl-muted" style={{ margin: '4px 0 12px' }}>
                {listing.riskClass} · {listing.jurisdiction} · capacity {formatMoney(listing.capacity)} ·{' '}
                {listing.durationDays} days
              </p>
              <InterestForm listingId={listing.id} />
            </div>
          ))
        )}
      </div>
    </PortalShell>
  );
}
