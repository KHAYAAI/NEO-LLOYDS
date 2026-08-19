import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import { ClaimLookup } from './claim-lookup';

export default async function DashboardPage() {
  await requireCredential();

  return (
    <PortalShell>
      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>Find a claim</h2>
        <p className="nl-muted">
          There is no &ldquo;list all claims&rdquo; endpoint — only{' '}
          <code>GET /claims/by-syndication/:syndicationId</code> and <code>GET /claims/:id</code>. Look a
          claim up by id (a reported claim gives you its id in the corporate portal, or via{' '}
          <code>POST /claims</code>) to advance it through the workflow: evidence review, coverage
          confirmation, loss calculation, human decision, and settlement.
        </p>
        <ClaimLookup />
      </div>
    </PortalShell>
  );
}
