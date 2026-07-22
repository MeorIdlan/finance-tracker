import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { api, ApiError } from '../api';
import { useAuth } from '../auth-context';
import AuthCard from '../components/AuthCard';
import Button from '../components/Button';
import Input from '../components/Input';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
      navigate(searchParams.get('next') ?? '/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Login was cancelled or failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Log in">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy} className="w-full">
          Continue with passkey
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="mt-4 text-xs text-muted">
        <Link to="/recover" className="text-accent hover:underline">
          Lost your passkeys?
        </Link>{' '}
        ·{' '}
        <Link to="/register" className="text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
