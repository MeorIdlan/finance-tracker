import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { PasskeySummary } from '@finance/shared';
import { api, ApiError } from '../api';
import Button from '../components/Button';
import IconButton from '../components/IconButton';
import { TrashIcon } from '../components/icons';

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
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Link to="/dashboard" className="text-xs text-accent hover:underline">
          Back to dashboard
        </Link>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Passkeys
          </h2>
          <Button onClick={addPasskey}>+ Add a passkey</Button>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3">
              <div className="text-sm text-ink">
                {p.deviceLabel}{' '}
                <span className="text-muted">
                  — added {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </div>
              <IconButton
                label="Remove"
                variant="destructive"
                onClick={() => removePasskey(p.id)}
              >
                <TrashIcon />
              </IconButton>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          Recent activity
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {audit.map((a, i) => (
            <li key={i} className="px-4 py-2 text-sm">
              <span className="font-mono text-xs tabular-nums text-muted">
                {new Date(a.timestamp).toLocaleString()}
              </span>{' '}
              <span className="text-ink">{a.action}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
