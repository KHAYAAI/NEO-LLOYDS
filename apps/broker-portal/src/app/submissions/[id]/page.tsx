import type {
  AnalystReport,
  RiskSubmission,
  SubmissionStatus,
  UnderwritingAssessment,
} from '@neo-lloyds/domain';
import { SUBMISSION_STATUSES } from '@neo-lloyds/domain';
import { apiFetch, ApiError } from '@/lib/api';
import { requireCredential } from '@/lib/require-session';
import { PortalShell } from '@/components/portal-shell';
import { StatusBadge } from '@/components/status-badge';
import { AdvanceButton } from './advance-button';
import { ScoreForm } from './score-form';
import { ListForm } from './list-form';

async function tryFetch<T>(path: string): Promise<{ data: T } | { notFound: true } | { error: string }> {
  try {
    return { data: await apiFetch<T>(path) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { notFound: true };
    if (error instanceof ApiError) return { error: `${error.message} (HTTP ${error.status})` };
    throw error;
  }
}

export default async function SubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCredential();
  const { id } = await params;

  const { submission } = await apiFetch<{ submission: RiskSubmission }>(`/submissions/${id}`);
  const analystResult = await tryFetch<AnalystReport>(`/analyst/risks/${submission.riskId}`);
  const assessmentResult = await tryFetch<{ assessment: UnderwritingAssessment }>(
    `/underwriting/risks/${submission.riskId}/assessment`,
  );
  const clearanceResult = await tryFetch<{ cleared: boolean }>(
    `/underwriting/risks/${submission.riskId}/clearance`,
  );

  const currentIndex = SUBMISSION_STATUSES.indexOf(submission.status);
  const nextStatus: SubmissionStatus | undefined = SUBMISSION_STATUSES[currentIndex + 1];
  const cleared = 'data' in clearanceResult && clearanceResult.data.cleared;

  return (
    <PortalShell>
      <div className="nl-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{submission.title}</h2>
          <StatusBadge status={submission.status} />
        </div>
        <p className="nl-muted">
          Risk <code>{submission.riskId}</code> · created {new Date(submission.createdAt).toLocaleString()}
        </p>
        {nextStatus ? (
          <div className="nl-actions">
            <AdvanceButton submissionId={submission.id} to={nextStatus} />
          </div>
        ) : (
          <p className="nl-muted">Submission has reached its final state, READY_FOR_UNDERWRITING.</p>
        )}
      </div>

      <div className="nl-panel">
        <h3 style={{ marginTop: 0 }}>AI analyst findings — advisory, never a decision</h3>
        {'notFound' in analystResult ? (
          <p className="nl-empty">No findings yet.</p>
        ) : 'error' in analystResult ? (
          <p className="nl-error">{analystResult.error}</p>
        ) : analystResult.data.findings.length === 0 ? (
          <p className="nl-empty">No findings.</p>
        ) : (
          <ul>
            {analystResult.data.findings.map((finding, i) => (
              <li key={i}>
                <strong>{finding.kind}</strong> ({(finding.confidence * 100).toFixed(0)}% confidence): {finding.statement}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="nl-panel">
        <h3 style={{ marginTop: 0 }}>Score this risk (Phase 2)</h3>
        <ScoreForm riskId={submission.riskId} submissionId={submission.id} />
      </div>

      <div className="nl-panel">
        <h3 style={{ marginTop: 0 }}>Underwriting</h3>
        {'notFound' in assessmentResult ? (
          <p className="nl-muted">Not yet assessed. An UNDERWRITER-role credential must call POST /underwriting/risks/:id/assess.</p>
        ) : 'error' in assessmentResult ? (
          <p className="nl-error">{assessmentResult.error}</p>
        ) : (
          <p>
            Band: <strong>{assessmentResult.data.assessment.band}</strong> · Control:{' '}
            {assessmentResult.data.assessment.control} · Human approval required:{' '}
            {assessmentResult.data.assessment.requiresHumanApproval ? 'yes' : 'no'}
          </p>
        )}
        <p className={cleared ? 'nl-muted' : 'nl-error'}>
          {cleared
            ? 'Clear to proceed to a marketplace listing.'
            : 'error' in clearanceResult
              ? clearanceResult.error
              : 'Not yet clear to proceed.'}
        </p>
      </div>

      <div className="nl-panel">
        <h3 style={{ marginTop: 0 }}>List to marketplace (Phase 4)</h3>
        {!cleared && <p className="nl-muted">Listing will be rejected until underwriting clearance is granted.</p>}
        <ListForm submissionId={submission.id} riskId={submission.riskId} />
      </div>
    </PortalShell>
  );
}
