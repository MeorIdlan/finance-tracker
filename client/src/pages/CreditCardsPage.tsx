import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CreditCardDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';
import Button from '../components/Button';
import Input from '../components/Input';
import IconButton from '../components/IconButton';
import { TrashIcon } from '../components/icons';
import Drawer from '../components/Drawer';

export default function CreditCardsPage() {
  const [items, setItems] = useState<CreditCardDto[]>([]);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [statementDay, setStatementDay] = useState('1');
  const [dueDay, setDueDay] = useState('22');
  const [openingBalance, setOpeningBalance] = useState('');

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
    let currentBalance: number | undefined;
    if (openingBalance.trim() !== '') {
      const sen = parseRM(openingBalance);
      if (sen === null) return setError('Invalid opening balance.');
      currentBalance = sen;
    }
    try {
      await api('/credit-cards', {
        method: 'POST',
        body: {
          name,
          creditLimit: limitSen,
          statementDay: parseInt(statementDay, 10),
          dueDay: parseInt(dueDay, 10),
          ...(currentBalance !== undefined ? { currentBalance } : {}),
        },
      });
      setName('');
      setLimit('');
      setOpeningBalance('');
      setDrawerOpen(false);
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
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Credit cards</h1>
        <Button onClick={() => setDrawerOpen(true)}>+ Add card</Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm text-ink">{c.name}</div>
              <div className="text-sm text-muted">
                statement{' '}
                <span className="font-mono tabular-nums">
                  {formatSen(c.statementBalance)}
                </span>{' '}
                (due day <span className="font-mono tabular-nums">{c.dueDay}</span>),
                current{' '}
                <span className="font-mono tabular-nums">
                  {formatSen(c.currentBalance)}
                </span>{' '}
                of{' '}
                <span className="font-mono tabular-nums">
                  {formatSen(c.creditLimit)}
                </span>{' '}
                limit
              </div>
            </div>
            <IconButton
              label="Delete"
              variant="destructive"
              onClick={() => remove(c.id)}
            >
              <TrashIcon />
            </IconButton>
          </li>
        ))}
      </ul>

      <Drawer open={drawerOpen} title="Add card" onClose={() => setDrawerOpen(false)}>
        <form onSubmit={add} className="flex flex-col gap-4">
          <Input
            id="name"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            id="limit"
            label="Credit limit (RM)"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
          />
          <Input
            id="statementDay"
            label="Statement day"
            type="number"
            min={1}
            max={28}
            value={statementDay}
            onChange={(e) => setStatementDay(e.target.value)}
          />
          <Input
            id="dueDay"
            label="Payment due day"
            type="number"
            min={1}
            max={28}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
          />
          <Input
            id="openingBalance"
            label="Opening balance (RM, optional)"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
          />
          <Button type="submit" className="w-full">
            Add card
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
