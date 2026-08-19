'use client';

import { useActionState } from 'react';
import { reportClaim, type ReportClaimState } from './actions';

const initialState: ReportClaimState = {};

export function ReportClaimForm() {
  const [state, formAction, pending] = useActionState(reportClaim, initialState);

  return (
    <form action={formAction}>
      <div className="nl-field">
        <label htmlFor="syndicationId">Syndication id</label>
        <input id="syndicationId" name="syndicationId" type="text" placeholder="A BOUND syndication" required />
      </div>
      <div className="nl-field">
        <label htmlFor="riskId">Risk id</label>
        <input id="riskId" name="riskId" type="text" required />
      </div>
      <div className="nl-field">
        <label htmlFor="incidentDescription">Incident description</label>
        <textarea id="incidentDescription" name="incidentDescription" rows={4} required />
      </div>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Reporting…' : 'Report claim'}
      </button>
      {state.error ? <p className="nl-error">{state.error}</p> : null}
    </form>
  );
}
