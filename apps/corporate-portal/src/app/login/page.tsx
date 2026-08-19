import { LoginForm } from './login-form';
import { signInWithWorkos } from './workos-actions';

export default function LoginPage() {
  return (
    <div className="nl-shell" style={{ maxWidth: 420 }}>
      <div className="nl-header">
        <h1>Neo-Lloyds Corporate Portal</h1>
      </div>

      {process.env.WORKOS_CLIENT_ID ? (
        <div className="nl-panel">
          <p className="nl-muted" style={{ marginTop: 0 }}>
            Sign in with your organisation&rsquo;s identity provider via WorkOS AuthKit
            (docs/security-model.md §10).
          </p>
          <form action={signInWithWorkos}>
            <button className="nl-button" type="submit">
              Sign in with WorkOS
            </button>
          </form>
        </div>
      ) : null}

      <div className="nl-panel">
        <p className="nl-muted" style={{ marginTop: 0 }}>
          Paste an API credential issued via <code>POST /identity/organisations/:id/credentials</code>{' '}
          for an organisation holding the <code>RISK_ORIGINATOR</code> or <code>BROKER</code> role.
          The secret is stored only in an httpOnly session cookie on this server — never in
          browser-readable storage.
        </p>
        <LoginForm />
      </div>
    </div>
  );
}
