import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  BankAccountDto,
  SavingsAccountDto,
  ValueSnapshotDto,
} from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';

export default function AccountsPage() {
  const [banks, setBanks] = useState<BankAccountDto[]>([]);
  const [savings, setSavings] = useState<SavingsAccountDto[]>([]);
  const [error, setError] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankOpening, setBankOpening] = useState('');
  const [savName, setSavName] = useState('');
  const [savType, setSavType] = useState<'savings' | 'investment'>('savings');
  const [snapshotsFor, setSnapshotsFor] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<ValueSnapshotDto[]>([]);
  const [snapDate, setSnapDate] = useState('');
  const [snapValue, setSnapValue] = useState('');

  const load = useCallback(async () => {
    setBanks(await api<BankAccountDto[]>('/accounts/bank'));
    setSavings(await api<SavingsAccountDto[]>('/accounts/savings'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handle(err: unknown) {
    setError(err instanceof ApiError ? err.message : 'Something went wrong.');
  }

  async function addBank(e: FormEvent) {
    e.preventDefault();
    setError('');
    const openingBalance = parseRM(bankOpening);
    if (openingBalance === null) return setError('Invalid opening balance.');
    try {
      await api('/accounts/bank', {
        method: 'POST',
        body: { name: bankName, openingBalance },
      });
      setBankName('');
      setBankOpening('');
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function renameBank(id: string) {
    const name = window.prompt('New name?');
    if (!name) return;
    try {
      await api(`/accounts/bank/${id}`, { method: 'PATCH', body: { name } });
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function deleteBank(id: string) {
    try {
      await api(`/accounts/bank/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function recompute(id: string) {
    try {
      const res = await api<{ drift: number }>(
        `/accounts/bank/${id}/recompute`,
        { method: 'POST' },
      );
      setError(
        res.drift === 0
          ? 'Balance verified: no drift.'
          : `Balance repaired: drift was ${formatSen(res.drift)}.`,
      );
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function addSavings(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/accounts/savings', {
        method: 'POST',
        body: { name: savName, type: savType },
      });
      setSavName('');
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function deleteSavings(id: string) {
    try {
      await api(`/accounts/savings/${id}`, { method: 'DELETE' });
      if (snapshotsFor === id) setSnapshotsFor(null);
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function openSnapshots(id: string) {
    setSnapshotsFor(id);
    setSnapshots(await api<ValueSnapshotDto[]>(`/accounts/savings/${id}/snapshots`));
  }

  async function addSnapshot(e: FormEvent) {
    e.preventDefault();
    if (!snapshotsFor) return;
    const value = parseRM(snapValue);
    if (value === null || !snapDate) return setError('Invalid snapshot input.');
    try {
      await api(`/accounts/savings/${snapshotsFor}/snapshots`, {
        method: 'POST',
        body: { date: snapDate, value },
      });
      setSnapValue('');
      await openSnapshots(snapshotsFor);
      await load();
    } catch (err) {
      handle(err);
    }
  }

  return (
    <main>
      <h1>Accounts</h1>
      {error && <p role="alert">{error}</p>}

      <section>
        <h2>Bank accounts</h2>
        <ul>
          {banks.map((b) => (
            <li key={b.id}>
              {b.name}: {formatSen(b.currentBalance)}{' '}
              <button onClick={() => renameBank(b.id)}>Rename</button>{' '}
              <button onClick={() => recompute(b.id)}>Verify balance</button>{' '}
              <button onClick={() => deleteBank(b.id)}>Delete</button>
            </li>
          ))}
        </ul>
        <form onSubmit={addBank}>
          <input
            placeholder="Account name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            required
          />
          <input
            placeholder="Opening balance (RM)"
            value={bankOpening}
            onChange={(e) => setBankOpening(e.target.value)}
            required
          />
          <button type="submit">Add bank account</button>
        </form>
      </section>

      <section>
        <h2>Savings & investments</h2>
        <ul>
          {savings.map((s) => (
            <li key={s.id}>
              {s.name} ({s.type}):{' '}
              {s.latestValue === null ? 'no value yet' : formatSen(s.latestValue)}{' '}
              <button onClick={() => openSnapshots(s.id)}>Snapshots</button>{' '}
              <button onClick={() => deleteSavings(s.id)}>Delete</button>
            </li>
          ))}
        </ul>
        <form onSubmit={addSavings}>
          <input
            placeholder="Name"
            value={savName}
            onChange={(e) => setSavName(e.target.value)}
            required
          />
          <select
            value={savType}
            onChange={(e) => setSavType(e.target.value as 'savings' | 'investment')}
          >
            <option value="savings">Savings</option>
            <option value="investment">Investment</option>
          </select>
          <button type="submit">Add</button>
        </form>

        {snapshotsFor && (
          <div>
            <h3>Value history</h3>
            <ul>
              {snapshots.map((s) => (
                <li key={s.id}>
                  {s.date.slice(0, 10)}: {formatSen(s.value)}
                </li>
              ))}
            </ul>
            <form onSubmit={addSnapshot}>
              <input
                type="date"
                value={snapDate}
                onChange={(e) => setSnapDate(e.target.value)}
                required
              />
              <input
                placeholder="Value (RM)"
                value={snapValue}
                onChange={(e) => setSnapValue(e.target.value)}
                required
              />
              <button type="submit">Log value</button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
