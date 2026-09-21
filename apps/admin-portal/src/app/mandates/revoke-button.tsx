'use client';

import { useActionState } from 'react';
import { revokeMandate, type ActionState } from './actions';

const initialState: ActionState = {};

/**
 * The Mandate Control Center's "kill switch": a real, working button, not
 * a mockup. Confirms once (an irreversible action -- a revoked mandate
 * cannot be un-revoked, only reissued) before calling the real revoke
 * endpoint via the server action in actions.ts.
 */
export function RevokeButton({ mandateId, agentLegalName }: { mandateId: string; agentLegalName: string }) {
  const [state, formAction, pending] = useActionState(revokeMandate.bind(null, mandateId), initialState);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Revoke this mandate for ${agentLegalName}? This cannot be undone.`)) {
          event.preventDefault();
        }
      }}
    >
      <button className="nl-button nl-button-danger" type="submit" disabled={pending}>
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {state.error ? <p className="nl-error" style={{ margin: '4px 0 0' }}>{state.error}</p> : null}
    </form>
  );
}
