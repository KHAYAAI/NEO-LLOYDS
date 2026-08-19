import { notFound } from 'next/navigation';
import type { Organisation } from '@neo-lloyds/domain';
import { apiFetch } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import { RoleForm } from './role-form';
import { KybForm } from './kyb-form';
import { CredentialForm } from './credential-form';

export default async function OrganisationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCredential();
  const { id } = await params;

  // GET /identity/organisations/:id enforces tenant isolation
  // (requireTenantAccess) — an admin credential belonging to one
  // organisation cannot read another organisation's single-record detail
  // unless it holds REGULATOR. GET /identity/organisations (the list) has
  // no such restriction, so this portal finds the record there instead of
  // hitting the tenant-restricted endpoint — reflecting the API's real
  // authorisation model rather than working around it.
  const { organisations } = await apiFetch<{ organisations: Organisation[] }>('/identity/organisations');
  const organisation = organisations.find((org) => org.id === id);
  if (!organisation) notFound();

  return (
    <PortalShell>
      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>{organisation.legalName}</h2>
        <p className="nl-muted">
          {organisation.kind} · {organisation.jurisdiction} · KYB {organisation.kybStatus} ·{' '}
          {organisation.active ? 'active' : 'inactive'}
        </p>
        <p className="nl-muted">Roles: {organisation.roles.join(', ') || 'none'}</p>
        {organisation.principalOrganisationId ? (
          <p className="nl-muted">Principal: {organisation.principalOrganisationId}</p>
        ) : null}
      </div>

      <div className="nl-panel">
        <h3 style={{ marginTop: 0 }}>Grant a market role</h3>
        <RoleForm organisationId={organisation.id} />
      </div>

      <div className="nl-panel">
        <h3 style={{ marginTop: 0 }}>KYB status</h3>
        <p className="nl-muted">Prototype: manual decision only, no KYB provider is integrated.</p>
        <KybForm organisationId={organisation.id} />
      </div>

      <div className="nl-panel">
        <h3 style={{ marginTop: 0 }}>Issue a credential</h3>
        <CredentialForm organisationId={organisation.id} />
      </div>
    </PortalShell>
  );
}
