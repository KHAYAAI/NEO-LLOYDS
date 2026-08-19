'use client';

import { useActionState } from 'react';
import { setCommitment, type ActionState } from './actions';

const initialState: ActionState = {};

export function CommitmentForm() {
  const [state, formAction, pending] = useActionState(setCommitment, initialState);

  return (
    <form action={formAction} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <div className="nl-field" style={{ marginBottom: 0 }}>
        <label>Committed capital (minor units)</label>
        <input name="committedMinor" type="number" min={1} defaultValue={1000000000} required />
      </div>
      <div className="nl-field" style={{ marginBottom: 0 }}>
        <label>Currency</label>
        <input name="currency" type="text" maxLength={3} defaultValue="USD" required style={{ width: 70 }} />
      </div>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Set commitment'}
      </button>
      {state.error ? <p className="nl-error" style={{ width: '100%' }}>{state.error}</p> : null}
      {state.success ? <p className="nl-muted" style={{ width: '100%' }}>{state.success}</p> : null}
    </form>
  );
}
