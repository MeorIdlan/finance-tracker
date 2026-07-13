import { FormEvent, useCallback, useEffect, useState } from 'react';
import { LoanDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';

export default function LoansPage() {
  const [items, setItems] = useState<LoanDto[]>([]);
  const [error, setError] = useState('');
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
    <main>
      <h1>Loans</h1>
      {error && <p role="alert">{error}</p>}
      <ul>
        {items.map((l) => {
          const paidPct =
            l.principal > 0
              ? Math.round(((l.principal - l.currentBalance) / l.principal) * 100)
              : 0;
          return (
            <li key={l.id}>
              {l.name}: {formatSen(l.currentBalance)} remaining of{' '}
              {formatSen(l.principal)} ({paidPct}% paid, {l.interestRate}% p.a.){' '}
              <button onClick={() => remove(l.id)}>Delete</button>
            </li>
          );
        })}
      </ul>
      <form onSubmit={add}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          placeholder="Principal (RM)"
          value={principal}
          onChange={(e) => setPrincipal(e.target.value)}
          required
        />
        <input
          placeholder="Interest rate % p.a."
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
        <input
          placeholder="Current balance (RM, optional)"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
        />
        <button type="submit">Add loan</button>
      </form>
    </main>
  );
}
