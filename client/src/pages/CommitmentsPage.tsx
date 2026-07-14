import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CommitmentDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';
import Button from '../components/Button';
import Input from '../components/Input';
import Badge from '../components/Badge';
import IconButton from '../components/IconButton';
import { TrashIcon } from '../components/icons';
import Drawer from '../components/Drawer';

const STATUS_LABEL = {
  overdue: 'OVERDUE',
  dueSoon: 'Due soon',
  upcoming: 'Upcoming',
} as const;

const STATUS_TONE = {
  overdue: 'danger',
  dueSoon: 'warning',
  upcoming: 'muted',
} as const;

export default function CommitmentsPage() {
  const [items, setItems] = useState<CommitmentDto[]>([]);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
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
      setDueDay('1');
      setDrawerOpen(false);
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
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Commitments</h1>
        <Button onClick={() => setDrawerOpen(true)}>+ Add commitment</Button>
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
              <div className="flex items-center gap-2 text-sm text-ink">
                {c.name}
                <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                {!c.active && <Badge tone="muted">Inactive</Badge>}
              </div>
              <div className="text-sm text-muted">
                <span className="font-mono tabular-nums">{formatSen(c.amount)}</span>{' '}
                — due{' '}
                <span className="font-mono tabular-nums">
                  {c.nextDueDate.slice(0, 10)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="secondary" onClick={() => toggleActive(c)}>
                {c.active ? 'Deactivate' : 'Activate'}
              </Button>
              <IconButton
                label="Delete"
                variant="destructive"
                onClick={() => remove(c.id)}
              >
                <TrashIcon />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>

      <Drawer
        open={drawerOpen}
        title="Add commitment"
        onClose={() => setDrawerOpen(false)}
      >
        <form onSubmit={add} className="flex flex-col gap-4">
          <Input
            id="name"
            label="Name (e.g. Rent)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            id="amount"
            label="Amount (RM)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <Input
            id="dueDay"
            label="Due day of month"
            type="number"
            min={1}
            max={31}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            required
          />
          <Button type="submit" className="w-full">
            Add commitment
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
