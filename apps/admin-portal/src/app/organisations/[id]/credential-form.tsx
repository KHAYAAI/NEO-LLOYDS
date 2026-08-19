'use client';

import { useActionState } from 'react';
import { issueCredential, type CredentialState } from './actions';

const initialState: CredentialState = {};

export function CredentialForm({ organisationId }: { organisationId: string }) {
  const [state, formAction, pending] = useActionState(
    issueCredential.bind(null, organisationId),
    initialState,
  );

  return (
    <form action={formAction}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="nl-field">
          <label htmlFor="label">Label</label>
          <input id="label" name="label" type="text" placeholder="e.g. broker-portal-prod" required />
        </div>
        <div className="nl-field">
          <label htmlFor="scopes">Scopes (comma-separated, or *)</label>
          <input id="scopes" name="scopes" type="text" placeholder="submission:read, submission:write" required />
        </div>
        <div className="nl-field">
          <label htmlFor="subjectKind">Subject kind</label>
          <select id="subjectKind" name="subjectKind" defaultValue="SERVICE">
            <option value="USER">USER</option>
            <option value="SERVICE">SERVICE</option>
            <option value="AGENT">AGENT</option>
          </select>
        </div>
      </div>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Issuing…' : 'Issue credential'}
      </button>
      {state.error ? <p className="nl-error">{state.error}</p> : null}
      {state.secret ? (
        <div className="nl-panel" style={{ marginTop: 12, background: '#1a1200', borderColor: '#5c4413' }}>
          <p className="nl-muted" style={{ marginTop: 0 }}>
            Store this now — the secret cannot be retrieved again.
          </p>
          <code style={{ wordBreak: 'break-all' }}>
            {state.keyId}.{state.secret}
          </code>
        </div>
      ) : null}
    </form>
  );
}
