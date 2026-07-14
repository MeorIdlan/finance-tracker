import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  BankAccountDto,
  SavingsAccountDto,
  ValueSnapshotDto,
} from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';
import Button from '../components/Button';
import Input from '../components/Input';
import Select from '../components/Select';
import IconButton from '../components/IconButton';
import { EditIcon, TrashIcon } from '../components/icons';
import Drawer from '../components/Drawer';

export default function AccountsPage() {
  const [banks, setBanks] = useState<BankAccountDto[]>([]);
  const [savings, setSavings] = useState<SavingsAccountDto[]>([]);
  const [error, setError] = useState('');

  const [addBankOpen, setAddBankOpen] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankOpening, setBankOpening] = useState('');

  const [renaming, setRenaming] = useState<BankAccountDto | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [addSavingsOpen, setAddSavingsOpen] = useState(false);
  const [savName, setSavName] = useState('');
  const [savType, setSavType] = useState<'savings' | 'investment'>('savings');

  const [snapshotsFor, setSnapshotsFor] = useState<SavingsAccountDto | null>(
    null,
  );
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
      setAddBankOpen(false);
      await load();
    } catch (err) {
      handle(err);
    }
  }

  function openRename(b: BankAccountDto) {
    setRenaming(b);
    setRenameValue(b.name);
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    setError('');
    try {
      await api(`/accounts/bank/${renaming.id}`, {
        method: 'PATCH',
        body: { name: renameValue },
      });
      setRenaming(null);
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
      setAddSavingsOpen(false);
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function deleteSavings(id: string) {
    try {
      await api(`/accounts/savings/${id}`, { method: 'DELETE' });
      if (snapshotsFor?.id === id) setSnapshotsFor(null);
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function openSnapshots(s: SavingsAccountDto) {
    setSnapshotsFor(s);
    setSnapshots(await api<ValueSnapshotDto[]>(`/accounts/savings/${s.id}/snapshots`));
  }

  async function addSnapshot(e: FormEvent) {
    e.preventDefault();
    if (!snapshotsFor) return;
    const value = parseRM(snapValue);
    if (value === null || !snapDate) return setError('Invalid snapshot input.');
    try {
      await api(`/accounts/savings/${snapshotsFor.id}/snapshots`, {
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
    <div>
      <h1 className="mb-6 text-lg font-semibold">Accounts</h1>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Bank accounts
          </h2>
          <Button onClick={() => setAddBankOpen(true)}>+ Add bank account</Button>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {banks.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm text-ink">{b.name}</div>
                <div className="font-mono text-sm tabular-nums text-muted">
                  {formatSen(b.currentBalance)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="secondary" onClick={() => recompute(b.id)}>
                  Verify balance
                </Button>
                <IconButton label="Rename" onClick={() => openRename(b)}>
                  <EditIcon />
                </IconButton>
                <IconButton
                  label="Delete"
                  variant="destructive"
                  onClick={() => deleteBank(b.id)}
                >
                  <TrashIcon />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Savings &amp; investments
          </h2>
          <Button onClick={() => setAddSavingsOpen(true)}>+ Add</Button>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {savings.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm text-ink">
                  {s.name} <span className="text-muted">({s.type})</span>
                </div>
                <div className="font-mono text-sm tabular-nums text-muted">
                  {s.latestValue === null ? 'no value yet' : formatSen(s.latestValue)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="secondary" onClick={() => openSnapshots(s)}>
                  Snapshots
                </Button>
                <IconButton
                  label="Delete"
                  variant="destructive"
                  onClick={() => deleteSavings(s.id)}
                >
                  <TrashIcon />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Drawer
        open={addBankOpen}
        title="Add bank account"
        onClose={() => setAddBankOpen(false)}
      >
        <form onSubmit={addBank} className="flex flex-col gap-4">
          <Input
            id="bankName"
            label="Account name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            required
          />
          <Input
            id="bankOpening"
            label="Opening balance (RM)"
            value={bankOpening}
            onChange={(e) => setBankOpening(e.target.value)}
            required
          />
          <Button type="submit" className="w-full">
            Add bank account
          </Button>
        </form>
      </Drawer>

      <Drawer
        open={renaming !== null}
        title="Rename bank account"
        onClose={() => setRenaming(null)}
      >
        <form onSubmit={submitRename} className="flex flex-col gap-4">
          <Input
            id="renameValue"
            label="Account name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            required
          />
          <Button type="submit" className="w-full">
            Save
          </Button>
        </form>
      </Drawer>

      <Drawer
        open={addSavingsOpen}
        title="Add savings / investment account"
        onClose={() => setAddSavingsOpen(false)}
      >
        <form onSubmit={addSavings} className="flex flex-col gap-4">
          <Input
            id="savName"
            label="Name"
            value={savName}
            onChange={(e) => setSavName(e.target.value)}
            required
          />
          <Select
            id="savType"
            label="Type"
            value={savType}
            onChange={(e) => setSavType(e.target.value as 'savings' | 'investment')}
          >
            <option value="savings">Savings</option>
            <option value="investment">Investment</option>
          </Select>
          <Button type="submit" className="w-full">
            Add
          </Button>
        </form>
      </Drawer>

      <Drawer
        open={snapshotsFor !== null}
        title={snapshotsFor ? `${snapshotsFor.name} — value history` : ''}
        onClose={() => setSnapshotsFor(null)}
      >
        <ul className="mb-4 space-y-1 text-sm">
          {snapshots.map((s) => (
            <li key={s.id} className="flex justify-between">
              <span className="font-mono text-xs tabular-nums text-muted">
                {s.date.slice(0, 10)}
              </span>
              <span className="font-mono tabular-nums text-ink">
                {formatSen(s.value)}
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={addSnapshot} className="flex flex-col gap-4">
          <Input
            id="snapDate"
            label="Date"
            type="date"
            value={snapDate}
            onChange={(e) => setSnapDate(e.target.value)}
            required
          />
          <Input
            id="snapValue"
            label="Value (RM)"
            value={snapValue}
            onChange={(e) => setSnapValue(e.target.value)}
            required
          />
          <Button type="submit" className="w-full">
            Log value
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
