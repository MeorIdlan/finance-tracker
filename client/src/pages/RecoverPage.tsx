import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import AuthCard from '../components/AuthCard';
import Button from '../components/Button';
import Input from '../components/Input';

export default function RecoverPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/recover', { method: 'POST', body: { email } });
      navigate('/register/verify', { state: { email, purpose: 'recovery' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Recover your account">
      <p className="mb-4 text-sm text-muted">
        We will email you a code, then you can register a new passkey.
      </p>
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
          Send recovery code
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </AuthCard>
  );
}
