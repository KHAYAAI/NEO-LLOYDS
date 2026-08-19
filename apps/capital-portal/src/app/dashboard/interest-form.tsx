'use client';

import { useActionState } from 'react';
import { expressInterest, type ActionState } from './actions';

const initialState: ActionState = {};

export function InterestForm({ listingId }: { listingId: string }) {
  const [state, formAction, pending] = useActionState(
    expressInterest.bind(null, listingId),
    initialState,
  );

  return (
    <form action={formAction} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div className="nl-field" style={{ marginBottom: 0 }}>
        <label>Amount (minor units)</label>
        <input name="indicativeAmountMinor" type="number" min={1} defaultValue={1000000} required />
      </div>
      <div className="nl-field" style={{ marginBottom: 0 }}>
        <label>Currency</label>
        <input name="currency" type="text" maxLength={3} defaultValue="USD" required style={{ width: 70 }} />
      </div>
      <div className="nl-field" style={{ marginBottom: 0, flex: 1, minWidth: 160 }}>
        <label>Note (optional)</label>
        <input name="note" type="text" placeholder="Indicative only" />
      </div>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Submitting…' : 'Express interest'}
      </button>
      {state.error ? <p className="nl-error" style={{ width: '100%' }}>{state.error}</p> : null}
      {state.success ? <p className="nl-muted" style={{ width: '100%' }}>{state.success}</p> : null}
    </form>
  );
}
