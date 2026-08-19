'use client';

import { useActionState } from 'react';
import { setKyb, type ActionState } from './actions';

const initialState: ActionState = {};
const STATUSES = ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'] as const;

export function KybForm({ organisationId }: { organisationId: string }) {
  const [state, formAction, pending] = useActionState(setKyb.bind(null, organisationId), initialState);

  return (
    <form action={formAction} style={{ display: 'flex', gap: 8 }}>
      <select name="status" defaultValue="VERIFIED">
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Updating…' : 'Set KYB status'}
      </button>
      {state.error ? <p className="nl-error" style={{ width: '100%' }}>{state.error}</p> : null}
      {state.success ? <p className="nl-muted" style={{ width: '100%' }}>{state.success}</p> : null}
    </form>
  );
}
