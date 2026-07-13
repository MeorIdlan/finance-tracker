import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CommitmentDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';

const STATUS_LABEL = {
  overdue: 'OVERDUE',
  dueSoon: 'Due soon',
  upcoming: 'Upcoming',
} as const;

export default function CommitmentsPage() {
  const [items, setItems] = useState<CommitmentDto[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('1');

  const load = useCallback(async () => {
    setItems(await api<CommitmentDto[]>('/commitments'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    const sen = parseRM(amount);
    if (sen === null) return setError('Invalid amount.');
    try {
      await api('/commitments', {
        method: 'POST',
        body: { name, amount: sen, dueDayOfMonth: parseInt(dueDay, 10) },
      });
      setName('');
      setAmount('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function toggleActive(c: CommitmentDto) {
    try {
      await api(`/commitments/${c.id}`, {
        method: 'PATCH',
        body: { active: !c.active },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  }

  async function remove(id: string) {
    try {
      await api(`/commitments/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  return (
    <main>
      <h1>Commitments</h1>
      {error && <p role="alert">{error}</p>}
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            {c.name}: {formatSen(c.amount)} — due{' '}
            {c.nextDueDate.slice(0, 10)} [{STATUS_LABEL[c.status]}]
            {!c.active && ' (inactive)'}{' '}
            <button onClick={() => toggleActive(c)}>
              {c.active ? 'Deactivate' : 'Activate'}
            </button>{' '}
            <button onClick={() => remove(c.id)}>Delete</button>
          </li>
        ))}
      </ul>
      <form onSubmit={add}>
        <input
          placeholder="Name (e.g. Rent)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          placeholder="Amount (RM)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <label>
          Due day of month
          <input
            type="number"
            min={1}
            max={31}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            required
          />
        </label>
        <button type="submit">Add commitment</button>
      </form>
    </main>
  );
}
