import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AgentTokenStatusDto } from '@finance/shared';
import { api, ApiError } from '../api';
import Button from '../components/Button';

const TOOLS = [
  { name: 'create_transaction', description: 'Record a new income/expense/transfer/payment.' },
  { name: 'get_summary', description: 'Balances, net worth, and bills due in the next 14 days.' },
  { name: 'list_transactions', description: 'Search recent transactions by type, category, account, or date range.' },
  { name: 'list_accounts', description: 'List bank accounts, commitments, loans, and credit cards.' },
];

export default function AgentPage() {
  const [status, setStatus] = useState<AgentTokenStatusDto | null>(null);
  const [freshToken, setFreshToken] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setStatus(await api<AgentTokenStatusDto>('/agent-token/status'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rotate() {
    setError('');
    try {
      const res = await api<{ token: string }>('/agent-token/rotate', { method: 'POST' });
      setFreshToken(res.token);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate a token.');
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
          Bearer token
        </h2>
        {!status ? null : !status.hasToken ? (
          <div>
            <p className="mb-3 text-sm text-muted">No agent token has been generated yet.</p>
            <Button onClick={rotate}>Generate token</Button>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm text-muted">
              Token created {new Date(status.createdAt!).toLocaleString()}
              {status.lastUsedAt
                ? `, last used ${new Date(status.lastUsedAt).toLocaleString()}`
                : ', never used yet'}
              .
            </p>
            <Button onClick={rotate}>Rotate token</Button>
          </div>
        )}

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
