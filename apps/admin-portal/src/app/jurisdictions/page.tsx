import type { JurisdictionModule } from '@neo-lloyds/config';
import { apiFetch } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';

export default async function JurisdictionsPage() {
  await requireCredential();
  const { jurisdictions } = await apiFetch<{ jurisdictions: JurisdictionModule[] }>('/jurisdictions');

  return (
    <PortalShell>
      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>Jurisdiction modules</h2>
        <p className="nl-muted">
          {jurisdictions[0]?.disclaimer ?? 'Illustrative regulatory summary only — not legal advice.'}
        </p>
      </div>

      {jurisdictions.map((j) => (
        <div key={j.code} className="nl-panel">
          <h3 style={{ marginTop: 0 }}>
            {j.name} <span className="nl-badge">{j.code}</span>
          </h3>
          <table className="nl-table">
            <tbody>
              <tr>
                <th>Regulator</th>
                <td>{j.regulator.name}</td>
              </tr>
              <tr>
                <th>Data residency</th>
                <td>
                  {j.dataResidency.regime}
                  {j.dataResidency.requiresLocalStorage ? ' — local storage required' : ''}
                </td>
              </tr>
              <tr>
                <th>Cross-border</th>
                <td>{j.crossBorder.permitted ? 'Permitted' : 'Materially restricted'}</td>
              </tr>
              <tr>
                <th>KYC/AML</th>
                <td>
                  {j.kycAml.level} — {j.kycAml.sanctionsRegimes.join(', ')}
                </td>
              </tr>
              <tr>
                <th>Capital treatment</th>
                <td>{j.capitalTreatment.framework}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </PortalShell>
  );
}
