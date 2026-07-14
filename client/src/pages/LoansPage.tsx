import { FormEvent, useCallback, useEffect, useState } from 'react';
import { LoanDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';
import Button from '../components/Button';
import Input from '../components/Input';
import IconButton from '../components/IconButton';
import { TrashIcon } from '../components/icons';
import Drawer from '../components/Drawer';

export default function LoansPage() {
  const [items, setItems] = useState<LoanDto[]>([]);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [balance, setBalance] = useState('');

  const load = useCallback(async () => {
    setItems(await api<LoanDto[]>('/loans'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    const principalSen = parseRM(principal);
    if (principalSen === null) return setError('Invalid principal.');
    const balanceSen = balance ? parseRM(balance) : null;
    if (balance && balanceSen === null) return setError('Invalid balance.');
    try {
      await api('/loans', {
        method: 'POST',
        body: {
          name,
          principal: principalSen,
          interestRate: parseFloat(rate) || 0,
          ...(balanceSen !== null ? { currentBalance: balanceSen } : {}),
        },
      });
      setName('');
      setPrincipal('');
      setRate('');
      setBalance('');
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function remove(id: string) {
    try {
      await api(`/loans/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Loans</h1>
        <Button onClick={() => setDrawerOpen(true)}>+ Add loan</Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((l) => {
          const paidPct =
            l.principal > 0
              ? Math.round(((l.principal - l.currentBalance) / l.principal) * 100)
              : 0;
          return (
            <li key={l.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm text-ink">{l.name}</div>
                <div className="text-sm text-muted">
                  <span className="font-mono tabular-nums">
                    {formatSen(l.currentBalance)}
                  </span>{' '}
                  remaining of{' '}
                  <span className="font-mono tabular-nums">
                    {formatSen(l.principal)}
                  </span>{' '}
                  (<span className="font-mono tabular-nums">{paidPct}%</span> paid,{' '}
                  <span className="font-mono tabular-nums">{l.interestRate}%</span> p.a.)
                </div>
              </div>
              <IconButton
                label="Delete"
                variant="destructive"
                onClick={() => remove(l.id)}
              >
                <TrashIcon />
              </IconButton>
            </li>
          );
        })}
      </ul>

      <Drawer open={drawerOpen} title="Add loan" onClose={() => setDrawerOpen(false)}>
        <form onSubmit={add} className="flex flex-col gap-4">
          <Input
            id="name"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            id="principal"
            label="Principal (RM)"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            required
          />
          <Input
            id="rate"
            label="Interest rate % p.a."
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <Input
            id="balance"
            label="Current balance (RM, optional)"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
          <Button type="submit" className="w-full">
            Add loan
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
