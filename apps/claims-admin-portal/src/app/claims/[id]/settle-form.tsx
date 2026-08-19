'use client';

import { useActionState } from 'react';
import { settle, type ActionState } from './actions';

const initialState: ActionState = {};

export function SettleForm({ claimId }: { claimId: string }) {
  const [state, formAction, pending] = useActionState(settle.bind(null, claimId), initialState);

  return (
    <form action={formAction} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Settling…' : 'Settle claim'}
      </button>
      {state.error ? <p className="nl-error">{state.error}</p> : null}
      {state.success ? <p className="nl-muted">{state.success}</p> : null}
    </form>
  );
}
