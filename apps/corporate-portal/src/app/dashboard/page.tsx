import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import { ReportClaimForm } from './report-claim-form';
import { ClaimLookup } from './claim-lookup';

export default async function DashboardPage() {
  await requireCredential();

  return (
    <PortalShell>
      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>Look up a claim</h2>
        <ClaimLookup />
      </div>

      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>Report a claim (Phase 7)</h2>
        <p className="nl-muted">
          Reports an incident against a <strong>BOUND</strong> syndication. Only the originating
          organisation may report — starts in <code>REPORTED</code>.
        </p>
        <ReportClaimForm />
      </div>
    </PortalShell>
  );
}
