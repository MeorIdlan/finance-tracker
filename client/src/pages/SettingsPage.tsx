import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { PasskeySummary } from '@finance/shared';
import { api, ApiError } from '../api';

interface AuditItem {
  action: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export default function SettingsPage() {
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setPasskeys(await api<PasskeySummary[]>('/passkeys'));
    const page = await api<{ items: AuditItem[]; total: number }>(
      '/audit-log?page=1&pageSize=20',
    );
    setAudit(page.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addPasskey() {
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
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Passkey creation failed.');
    }
  }

  async function removePasskey(id: string) {
    setError('');
    try {
      await api(`/passkeys/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove passkey.');
    }
  }

  return (
    <main>
      <h1>Settings</h1>
      <Link to="/dashboard">Back to dashboard</Link>
      {error && <p role="alert">{error}</p>}

      <section>
        <h2>Passkeys</h2>
        <ul>
          {passkeys.map((p) => (
            <li key={p.id}>
              {p.deviceLabel} — added{' '}
              {new Date(p.createdAt).toLocaleDateString()}{' '}
              <button onClick={() => removePasskey(p.id)}>Remove</button>
            </li>
          ))}
        </ul>
        <button onClick={addPasskey}>Add a passkey</button>
      </section>

      <section>
        <h2>Recent activity</h2>
        <ul>
          {audit.map((a, i) => (
            <li key={i}>
              {new Date(a.timestamp).toLocaleString()} — {a.action}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
