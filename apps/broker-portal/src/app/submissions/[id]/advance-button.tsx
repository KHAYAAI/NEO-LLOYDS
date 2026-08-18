'use client';

import { useActionState } from 'react';
import { advanceSubmission } from './actions';
import { initialActionState } from './action-state';

export function AdvanceButton({ submissionId, to }: { submissionId: string; to: string }) {
  const [state, formAction, pending] = useActionState(
    advanceSubmission.bind(null, submissionId, to),
    initialActionState,
  );

  return (
    <form action={formAction} style={{ display: 'inline' }}>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Advancing…' : `Advance to ${to.replace(/_/g, ' ')}`}
      </button>
      {state.error ? <p className="nl-error">{state.error}</p> : null}
    </form>
  );
}
