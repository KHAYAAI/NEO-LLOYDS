'use client';

import { useActionState } from 'react';
import { login, type LoginState } from './actions';

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction}>
      <div className="nl-field">
        <label htmlFor="credential">API credential</label>
        <input id="credential" name="credential" type="password" placeholder="nlk_xxx.yyy" required />
      </div>
      <button className="nl-button" type="submit" disabled={pending}>
        {pending ? 'Checking…' : 'Sign in'}
      </button>
      {state.error ? <p className="nl-error">{state.error}</p> : null}
    </form>
  );
}
