import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { api, ApiError } from '../api';
import { useAuth } from '../auth-context';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { challengeId, options } = await api<{
        challengeId: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      }>('/auth/login/options', { method: 'POST', body: { email } });
      const response = await startAuthentication({ optionsJSON: options });
      await api('/auth/login/verify', {
        method: 'POST',
        body: { challengeId, response },
      });
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Login was cancelled or failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Log in</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          Continue with passkey
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <p>
        <Link to="/recover">Lost your passkeys?</Link> ·{' '}
        <Link to="/register">Create an account</Link>
      </p>
    </main>
  );
}
