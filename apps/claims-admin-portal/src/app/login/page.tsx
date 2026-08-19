import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <div className="nl-shell" style={{ maxWidth: 420 }}>
      <div className="nl-header">
        <h1>Neo-Lloyds Claims Administrator Portal</h1>
      </div>
      <div className="nl-panel">
        <p className="nl-muted" style={{ marginTop: 0 }}>
          Paste an API credential issued via <code>POST /identity/organisations/:id/credentials</code>{' '}
          for an organisation holding the <code>CLAIMS_ADMINISTRATOR</code> role, with the{' '}
          <code>claims:read</code>, <code>claims:process</code>, <code>claims:approve</code> and{' '}
          <code>claims:settle</code> scopes. The secret is stored only in an httpOnly session cookie on
          this server — never in browser-readable storage.
        </p>
        <LoginForm />
      </div>
    </div>
  );
}
