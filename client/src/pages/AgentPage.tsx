import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AgentTokenDto } from '@finance/shared';
import { api, ApiError } from '../api';
import Button from '../components/Button';
import IconButton from '../components/IconButton';
import Input from '../components/Input';
import { TrashIcon } from '../components/icons';

const TOOLS = [
  { name: 'create_transaction', description: 'Record a new income/expense/transfer/payment.' },
  { name: 'get_summary', description: 'Balances, net worth, and bills due in the next 14 days.' },
  { name: 'list_transactions', description: 'Search recent transactions by type, category, account, or date range.' },
  { name: 'list_accounts', description: 'List bank accounts, commitments, loans, and credit cards.' },
];

export default function AgentPage() {
  const [tokens, setTokens] = useState<AgentTokenDto[]>([]);
  const [label, setLabel] = useState('');
  const [freshToken, setFreshToken] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setTokens(await api<AgentTokenDto[]>('/agent-token/list'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setError('');
    try {
      const res = await api<{ token: string }>('/agent-token/create', {
        method: 'POST',
        body: { label },
      });
      setFreshToken(res.token);
      setLabel('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate a token.');
    }
  }

  async function revoke(id: string) {
    setError('');
    try {
      await api(`/agent-token/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke token.');
    }
  }

  const command = freshToken
    ? `claude mcp add --transport http finance-tracker ${window.location.origin}/api/mcp --header "Authorization: Bearer ${freshToken}"`
    : '';

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Agent access</h1>
        <Link to="/settings" className="text-xs text-accent hover:underline">
          Back to settings
        </Link>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          Bearer tokens
        </h2>
        {tokens.length === 0 ? (
          <p className="mb-4 text-sm text-muted">No agent tokens have been created yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-border rounded-lg border border-border">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-3">
                <div className="text-sm text-ink">
                  {t.label}{' '}
                  <span className="text-muted">
                    — {t.source} · created {new Date(t.createdAt).toLocaleDateString()}
                    {t.lastUsedAt
                      ? `, last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                      : ', never used yet'}
                  </span>
                </div>
                <IconButton label="Revoke" variant="destructive" onClick={() => revoke(t.id)}>
                  <TrashIcon />
                </IconButton>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2">
          <Input
            id="token-label"
            label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. manual script"
          />
          <Button onClick={create} disabled={!label.trim()}>
            Create new token
          </Button>
        </div>

        {freshToken && (
          <div className="mt-4 rounded-md border border-border bg-surface-raised p-3">
            <p className="mb-2 text-xs text-danger">
              This token won&apos;t be shown again — copy it now.
            </p>
            <input
              aria-label="Generated agent token"
              readOnly
              value={freshToken}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full break-all rounded border border-border bg-transparent p-1.5 font-mono text-sm"
            />
          </div>
        )}
      </section>

      {command && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
            Connect Claude Code
          </h2>
          <pre className="overflow-x-auto rounded-md border border-border bg-surface-raised p-3 text-xs">
            {command}
          </pre>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          Available tools
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {TOOLS.map((t) => (
            <li key={t.name} className="px-4 py-3 text-sm">
              <span className="font-mono text-ink">{t.name}</span>{' '}
              <span className="text-muted">— {t.description}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
