'use client';

import { useActionState } from 'react';
import { createOrganisation, type ActionState } from './actions';

const initialState: ActionState = {};

export function CreateOrgForm() {
  const [state, formAction, pending] = useActionState(createOrganisation, initialState);

  return (
    <form action={formAction}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <div className="nl-field">
          <label htmlFor="legalName">Legal name</label>
          <input id="legalName" name="legalName" type="text" required />
        </div>
        <div className="nl-field">
          <label htmlFor="kind">Kind</label>
          <select id="kind" name="kind" defaultValue="COMPANY">
            <option value="COMPANY">COMPANY</option>
            <option value="INDIVIDUAL">INDIVIDUAL</option>
            <option value="AI_AGENT">AI_AGENT</option>
            <option value="REGULATOR">REGULATOR</option>
          </select>
        </div>
        <div className="nl-field">
          <label htmlFor="jurisdiction">Jurisdiction</label>
          <input id="jurisdiction" name="jurisdiction" type="text" maxLength={2} placeholder="ZA" required />
        </div>
      </div>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create organisation'}
      </button>
      {state.error ? <p className="nl-error">{state.error}</p> : null}
      {state.success ? <p className="nl-muted">{state.success}</p> : null}
    </form>
  );
}
