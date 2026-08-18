import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import { NewSubmissionForm } from './new-submission-form';

export default async function NewSubmissionPage() {
  await requireCredential();

  return (
    <PortalShell>
      <div className="nl-panel">
        <h2 style={{ marginTop: 0 }}>New submission</h2>
        <p className="nl-muted">
          Creates a RISK node in your organisation&apos;s risk graph, then a submission
          referencing it (starts in <code>DRAFT</code>).
        </p>
        <NewSubmissionForm />
      </div>
    </PortalShell>
  );
}
