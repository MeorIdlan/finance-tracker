import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import AuthCard from '../components/AuthCard';
import Button from '../components/Button';
import Input from '../components/Input';

interface VerifyState {
  email: string;
  purpose: 'register' | 'recovery';
}

export default function VerifyOtpPage() {
  const location = useLocation();
  const state = location.state as VerifyState | null;
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (!state?.email) return <Navigate to="/register" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/verify-otp', {
        method: 'POST',
        body: { email: state!.email, code, purpose: state!.purpose },
      });
      navigate('/register/passkey');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Check your email">
      <p className="mb-4 text-sm text-muted">
        We sent a 6-digit code to {state.email}.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          id="code"
          label="Code"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          className="font-mono tracking-widest"
        />
        <Button type="submit" disabled={busy} className="w-full">
          Verify
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
