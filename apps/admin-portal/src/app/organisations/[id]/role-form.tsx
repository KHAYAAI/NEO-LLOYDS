'use client';

import { useActionState } from 'react';
import { MARKET_ROLES } from '@neo-lloyds/domain';
import { grantRole, type ActionState } from './actions';

const initialState: ActionState = {};

export function RoleForm({ organisationId }: { organisationId: string }) {
  const [state, formAction, pending] = useActionState(grantRole.bind(null, organisationId), initialState);

  return (
    <form action={formAction} style={{ display: 'flex', gap: 8 }}>
      <select name="role" defaultValue={MARKET_ROLES[0]}>
        {MARKET_ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Granting…' : 'Grant role'}
      </button>
      {state.error ? <p className="nl-error" style={{ width: '100%' }}>{state.error}</p> : null}
      {state.success ? <p className="nl-muted" style={{ width: '100%' }}>{state.success}</p> : null}
    </form>
  );
}
