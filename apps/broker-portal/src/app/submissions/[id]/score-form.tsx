'use client';

import { useActionState } from 'react';
import { scoreRisk } from './actions';
import { initialActionState } from './action-state';

export function ScoreForm({ riskId, submissionId }: { riskId: string; submissionId: string }) {
  const [state, formAction, pending] = useActionState(
    scoreRisk.bind(null, riskId, submissionId),
    initialActionState,
  );

  return (
    <form action={formAction}>
      <div className="nl-field">
        <label htmlFor="factorDescription">Primary factor</label>
        <input id="factorDescription" name="factorDescription" type="text" placeholder="e.g. Port congestion history" required />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="nl-field">
          <label htmlFor="weight">Weight (0–1)</label>
          <input id="weight" name="weight" type="number" step="0.01" min={0} max={1} defaultValue={0.5} required />
        </div>
        <div className="nl-field">
          <label htmlFor="likelihood">Likelihood (0–1)</label>
          <input id="likelihood" name="likelihood" type="number" step="0.01" min={0} max={1} defaultValue={0.2} required />
        </div>
        <div className="nl-field">
          <label htmlFor="confidence">Confidence (0–1)</label>
          <input id="confidence" name="confidence" type="number" step="0.01" min={0} max={1} defaultValue={0.7} required />
        </div>
      </div>
      <div className="nl-field">
        <label htmlFor="basis">Basis</label>
        <select id="basis" name="basis" defaultValue="EXPERT_JUDGEMENT">
          <option value="OBSERVED">OBSERVED</option>
          <option value="STATISTICAL_MODEL">STATISTICAL_MODEL</option>
          <option value="EXPERT_JUDGEMENT">EXPERT_JUDGEMENT</option>
          <option value="AI_INFERENCE">AI_INFERENCE</option>
          <option value="INSUFFICIENT_DATA">INSUFFICIENT_DATA</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="nl-field">
          <label htmlFor="maxLossMinor">Max estimated loss (minor units)</label>
          <input id="maxLossMinor" name="maxLossMinor" type="number" min={1} defaultValue={10000000} required />
        </div>
        <div className="nl-field">
          <label htmlFor="currency">Currency</label>
          <input id="currency" name="currency" type="text" maxLength={3} defaultValue="USD" required />
        </div>
        <div className="nl-field">
          <label htmlFor="durationDays">Duration (days)</label>
          <input id="durationDays" name="durationDays" type="number" min={1} defaultValue={30} required />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="nl-field">
          <label htmlFor="mitigationCoverage">Mitigation coverage (0–1)</label>
          <input id="mitigationCoverage" name="mitigationCoverage" type="number" step="0.01" min={0} max={1} defaultValue={0.3} required />
        </div>
        <div className="nl-field">
          <label htmlFor="correlatedRiskCount">Correlated risk count</label>
          <input id="correlatedRiskCount" name="correlatedRiskCount" type="number" min={0} defaultValue={0} required />
        </div>
        <div className="nl-field">
          <label htmlFor="concentrationShare">Concentration share (0–1)</label>
          <input id="concentrationShare" name="concentrationShare" type="number" step="0.01" min={0} max={1} defaultValue={0.1} required />
        </div>
      </div>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Scoring…' : 'Score risk'}
      </button>
      {state.error ? <p className="nl-error">{state.error}</p> : null}
      {state.success ? <p className="nl-muted">{state.success}</p> : null}
    </form>
  );
}
