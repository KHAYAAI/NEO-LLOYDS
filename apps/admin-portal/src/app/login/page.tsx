import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <div className="nl-shell" style={{ maxWidth: 420 }}>
      <div className="nl-header">
        <h1>Neo-Lloyds Admin Portal</h1>
      </div>
      <div className="nl-panel">
        <p className="nl-muted" style={{ marginTop: 0 }}>
          Paste an API credential with <code>identity:admin</code>/<code>identity:read</code>/
          <code>audit:read</code> scopes. The secret is stored only in an httpOnly session cookie
          on this server — never in browser-readable storage.
        </p>
        <LoginForm />
      </div>
    </div>
  );
}
