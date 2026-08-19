'use client';

import { useActionState } from 'react';
import { setAppetite, type ActionState } from './actions';

const initialState: ActionState = {};

export function AppetiteForm() {
  const [state, formAction, pending] = useActionState(setAppetite, initialState);

  return (
    <form action={formAction}>
      <div className="nl-field">
        <label htmlFor="preferredRiskClasses">Preferred risk classes (comma-separated)</label>
        <input id="preferredRiskClasses" name="preferredRiskClasses" type="text" placeholder="MARINE_CARGO, PROPERTY" required />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="nl-field">
          <label htmlFor="maxExposureMinor">Max exposure (minor units)</label>
          <input id="maxExposureMinor" name="maxExposureMinor" type="number" min={1} defaultValue={1000000000} required />
        </div>
        <div className="nl-field">
          <label htmlFor="currency">Currency</label>
          <input id="currency" name="currency" type="text" maxLength={3} defaultValue="USD" required />
        </div>
      </div>
      <div className="nl-field">
        <label htmlFor="preferredJurisdictions">Preferred jurisdictions (comma-separated ISO codes)</label>
        <input id="preferredJurisdictions" name="preferredJurisdictions" type="text" placeholder="ZA, GB" required />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="nl-field">
          <label htmlFor="minimumReturnBps">Min return (bps)</label>
          <input id="minimumReturnBps" name="minimumReturnBps" type="number" min={0} defaultValue={500} required />
        </div>
        <div className="nl-field">
          <label htmlFor="maxDurationDays">Max duration (days)</label>
          <input id="maxDurationDays" name="maxDurationDays" type="number" min={1} defaultValue={90} required />
        </div>
        <div className="nl-field">
          <label htmlFor="concentrationLimitBps">Concentration limit (bps)</label>
          <input id="concentrationLimitBps" name="concentrationLimitBps" type="number" min={0} max={10000} defaultValue={2000} required />
        </div>
      </div>
      <div className="nl-field">
        <label htmlFor="riskTolerance">Risk tolerance</label>
        <select id="riskTolerance" name="riskTolerance" defaultValue="MODERATE">
          <option value="CONSERVATIVE">CONSERVATIVE</option>
          <option value="MODERATE">MODERATE</option>
          <option value="AGGRESSIVE">AGGRESSIVE</option>
        </select>
      </div>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save appetite'}
      </button>
      {state.error ? <p className="nl-error">{state.error}</p> : null}
      {state.success ? <p className="nl-muted">{state.success}</p> : null}
    </form>
  );
}
