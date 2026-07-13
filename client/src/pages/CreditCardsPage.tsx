import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CreditCardDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';

export default function CreditCardsPage() {
  const [items, setItems] = useState<CreditCardDto[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [statementDay, setStatementDay] = useState('1');
  const [dueDay, setDueDay] = useState('22');

  const load = useCallback(async () => {
    setItems(await api<CreditCardDto[]>('/credit-cards'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    const limitSen = parseRM(limit);
    if (limitSen === null) return setError('Invalid credit limit.');
    try {
      await api('/credit-cards', {
        method: 'POST',
        body: {
          name,
          creditLimit: limitSen,
          statementDay: parseInt(statementDay, 10),
          dueDay: parseInt(dueDay, 10),
        },
      });
      setName('');
      setLimit('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function remove(id: string) {
    try {
      await api(`/credit-cards/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  return (
    <main>
      <h1>Credit cards</h1>
      {error && <p role="alert">{error}</p>}
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            {c.name}: statement {formatSen(c.statementBalance)} (due day{' '}
            {c.dueDay}), current {formatSen(c.currentBalance)} of{' '}
            {formatSen(c.creditLimit)} limit{' '}
            <button onClick={() => remove(c.id)}>Delete</button>
          </li>
        ))}
      </ul>
      <form onSubmit={add}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          placeholder="Credit limit (RM)"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          required
        />
        <label>
          Statement day
          <input
            type="number"
            min={1}
            max={28}
            value={statementDay}
            onChange={(e) => setStatementDay(e.target.value)}
          />
        </label>
        <label>
          Payment due day
          <input
            type="number"
            min={1}
            max={28}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
          />
        </label>
        <button type="submit">Add card</button>
      </form>
    </main>
  );
}
