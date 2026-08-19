'use client';

import { useActionState } from 'react';
import { addEvidence, type ActionState } from './actions';

const initialState: ActionState = {};

export function EvidenceForm({ claimId }: { claimId: string }) {
  const [state, formAction, pending] = useActionState(addEvidence.bind(null, claimId), initialState);

  return (
    <form action={formAction} style={{ display: 'flex', gap: 8 }}>
      <input name="evidenceRef" type="text" placeholder="e.g. s3://evidence/photo-1.jpg" required style={{ flex: 1 }} />
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Attaching…' : 'Attach evidence'}
      </button>
      {state.error ? <p className="nl-error" style={{ width: '100%' }}>{state.error}</p> : null}
      {state.success ? <p className="nl-muted" style={{ width: '100%' }}>{state.success}</p> : null}
    </form>
  );
}
