'use client';

import { useActionState } from 'react';
import { listToMarketplace } from './actions';
import { initialActionState } from './action-state';

export function ListForm({ submissionId, riskId }: { submissionId: string; riskId: string }) {
  const [state, formAction, pending] = useActionState(
    listToMarketplace.bind(null, submissionId, riskId),
    initialActionState,
  );

  return (
    <form action={formAction}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        <div className="nl-field">
          <label htmlFor="riskClass">Risk class</label>
          <input id="riskClass" name="riskClass" type="text" placeholder="MARINE_CARGO" required />
        </div>
        <div className="nl-field">
          <label htmlFor="capacityMinor">Capacity (minor units)</label>
          <input id="capacityMinor" name="capacityMinor" type="number" min={1} defaultValue={100000000} required />
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
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Listing…' : 'List to marketplace'}
      </button>
      {state.error ? <p className="nl-error">{state.error}</p> : null}
      {state.success ? <p className="nl-muted">{state.success}</p> : null}
    </form>
  );
}
