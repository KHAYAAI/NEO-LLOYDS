'use client';

import { useActionState } from 'react';
import { calculateLoss, type ActionState } from './actions';

const initialState: ActionState = {};

export function LossForm({ claimId }: { claimId: string }) {
  const [state, formAction, pending] = useActionState(calculateLoss.bind(null, claimId), initialState);

  return (
    <form action={formAction} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <input name="claimedLossAmount" type="number" step="0.01" min="0.01" placeholder="Amount" required />
      <input name="currency" type="text" maxLength={3} placeholder="USD" defaultValue="USD" required style={{ width: 70 }} />
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Testing coverage…' : 'Calculate loss'}
      </button>
      {state.error ? <p className="nl-error" style={{ width: '100%' }}>{state.error}</p> : null}
      {state.success ? <p className="nl-muted" style={{ width: '100%' }}>{state.success}</p> : null}
    </form>
  );
}
