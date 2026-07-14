import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { api, ApiError } from '../api';
import { useAuth } from '../auth-context';
import AuthCard from '../components/AuthCard';
import Button from '../components/Button';

export default function PasskeyPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  async function createPasskey() {
    setBusy(true);
    setError('');
    try {
      const options = await api<PublicKeyCredentialCreationOptionsJSON>(
        '/auth/passkey/options',
        { method: 'POST' },
      );
      const response = await startRegistration({ optionsJSON: options });
      await api('/auth/passkey/verify', {
        method: 'POST',
        body: { response, deviceLabel: navigator.platform || 'Passkey' },
      });
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Passkey creation was cancelled or failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Set up your passkey">
      <p className="mb-4 text-sm text-muted">
        Your device will prompt you to create a passkey for this site.
      </p>
      <Button onClick={createPasskey} disabled={busy} className="w-full">
        Create passkey
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </AuthCard>
  );
}
