import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';

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
    <main>
      <h1>Check your email</h1>
      <p>We sent a 6-digit code to {state.email}.</p>
      <form onSubmit={onSubmit}>
        <label>
          Code
          <input
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          Verify
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
