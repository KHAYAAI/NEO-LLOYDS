'use client';

import { useActionState } from 'react';
import { createSubmission, type NewSubmissionState } from './actions';

const initialState: NewSubmissionState = {};

export function NewSubmissionForm() {
  const [state, formAction, pending] = useActionState(createSubmission, initialState);

  return (
    <form action={formAction}>
      <div className="nl-field">
        <label htmlFor="label">Risk label</label>
        <input id="label" name="label" type="text" placeholder="e.g. Port closure > 72h — Durban" required />
      </div>
      <div className="nl-field">
        <label htmlFor="jurisdiction">Jurisdiction (ISO-3166-1 alpha-2)</label>
        <input id="jurisdiction" name="jurisdiction" type="text" placeholder="ZA" maxLength={2} required />
      </div>
      <div className="nl-field">
        <label htmlFor="title">Submission title</label>
        <input id="title" name="title" type="text" placeholder="e.g. Kalahari Logistics — marine cargo" required />
      </div>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create submission'}
      </button>
      {state.error ? <p className="nl-error">{state.error}</p> : null}
    </form>
  );
}
