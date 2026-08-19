'use client';

import { useActionState } from 'react';
import { decide, type ActionState } from './actions';

const initialState: ActionState = {};

export function DecideForm({ claimId }: { claimId: string }) {
  const [state, formAction, pending] = useActionState(decide.bind(null, claimId), initialState);

  return (
    <form action={formAction} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <select name="decision" required defaultValue="">
        <option value="" disabled>
          Decision
        </option>
        <option value="APPROVED">Approve</option>
        <option value="REJECTED">Reject</option>
      </select>
      <input name="reason" type="text" placeholder="Reason" required style={{ flex: 1, minWidth: 200 }} />
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Recording…' : 'Record decision'}
      </button>
      {state.error ? <p className="nl-error" style={{ width: '100%' }}>{state.error}</p> : null}
      {state.success ? <p className="nl-muted" style={{ width: '100%' }}>{state.success}</p> : null}
    </form>
  );
}
