'use client';

import { useActionState } from 'react';
import { advance, type ActionState } from './actions';

const initialState: ActionState = {};

export function AdvanceForm({ claimId, to }: { claimId: string; to: string }) {
  const [state, formAction, pending] = useActionState(advance.bind(null, claimId), initialState);

  return (
    <form action={formAction} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="hidden" name="to" value={to} />
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Advancing…' : `Advance to ${to}`}
      </button>
      {state.error ? <p className="nl-error">{state.error}</p> : null}
      {state.success ? <p className="nl-muted">{state.success}</p> : null}
    </form>
  );
}
