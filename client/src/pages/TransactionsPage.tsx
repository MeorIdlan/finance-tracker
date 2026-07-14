import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  BankAccountDto,
  CommitmentDto,
  CreditCardDto,
  EXPENSE_CATEGORIES,
  LoanDto,
  Paginated,
  TransactionDto,
  TransactionType,
} from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';
import Button from '../components/Button';
import Input from '../components/Input';
import Select from '../components/Select';
import Badge from '../components/Badge';
import IconButton from '../components/IconButton';
import { EditIcon, TrashIcon } from '../components/icons';
import Drawer from '../components/Drawer';
import Pagination from '../components/Pagination';

const TYPE_LABELS: Record<TransactionType, string> = {
  income: 'Income',
  expense: 'Expense',
  commitmentPayment: 'Commitment payment',
  loanPayment: 'Loan payment',
  cardPayment: 'Credit card payment',
  cardCharge: 'Credit card charge',
  transfer: 'Transfer',
};

const PAGE_SIZE = 20;

export default function TransactionsPage() {
  const [banks, setBanks] = useState<BankAccountDto[]>([]);
  const [commitments, setCommitments] = useState<CommitmentDto[]>([]);
  const [loans, setLoans] = useState<LoanDto[]>([]);
  const [cards, setCards] = useState<CreditCardDto[]>([]);
  const [items, setItems] = useState<TransactionDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState('');
  const [error, setError] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<TransactionDto | null>(null);

  // form state
  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [linkedEntityId, setLinkedEntityId] = useState('');
  const [note, setNote] = useState('');

  const needsAccount = type !== 'cardCharge';
  const needsCategory = type === 'expense';
  const needsToAccount = type === 'transfer';
  const linkedOptions =
    type === 'commitmentPayment'
      ? commitments.map((c) => [c.id, c.name])
      : type === 'loanPayment'
        ? loans.map((l) => [l.id, l.name])
        : type === 'cardPayment' || type === 'cardCharge'
          ? cards.map((c) => [c.id, c.name])
          : [];

  const loadRefs = useCallback(async () => {
    setBanks(await api<BankAccountDto[]>('/accounts/bank'));
    setCommitments(await api<CommitmentDto[]>('/commitments'));
    setLoans(await api<LoanDto[]>('/loans'));
    setCards(await api<CreditCardDto[]>('/credit-cards'));
  }, []);

  const loadList = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (filterType) params.set('type', filterType);
    const res = await api<Paginated<TransactionDto>>(
      `/transactions?${params.toString()}`,
    );
    setItems(res.items);
    setTotal(res.total);
  }, [page, filterType]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  function openAdd() {
    setEditing(null);
    setType('expense');
    setAmount('');
    setDate(new Date().toISOString().slice(0, 10));
    setCategory(EXPENSE_CATEGORIES[0]);
    setAccountId('');
    setToAccountId('');
    setLinkedEntityId('');
    setNote('');
    setDrawerOpen(true);
  }

  function openEdit(t: TransactionDto) {
    setEditing(t);
    setAmount((t.amount / 100).toFixed(2));
    setDrawerOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const sen = parseRM(amount);
    if (sen === null) return setError('Invalid amount.');
    try {
      if (editing) {
        await api(`/transactions/${editing.id}`, {
          method: 'PATCH',
          body: { amount: sen },
        });
      } else {
        await api('/transactions', {
          method: 'POST',
          body: {
            type,
            amount: sen,
            date,
            ...(needsCategory ? { category } : {}),
            ...(needsAccount ? { accountId } : {}),
            ...(needsToAccount ? { toAccountId } : {}),
            ...(linkedOptions.length ? { linkedEntityId } : {}),
            ...(note ? { note } : {}),
          },
        });
      }
      setDrawerOpen(false);
      await Promise.all([loadList(), loadRefs()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function remove(id: string) {
    try {
      await api(`/transactions/${id}`, { method: 'DELETE' });
      await Promise.all([loadList(), loadRefs()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Transactions</h1>
        <Button onClick={openAdd}>+ Add transaction</Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mb-4">
        <Select
          value={filterType}
          onChange={(e) => {
            setPage(1);
            setFilterType(e.target.value);
          }}
          className="w-auto"
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted">
                  {t.date.slice(0, 10)}
                </td>
                <td className="px-3 py-2">
                  <Badge tone="accent">{TYPE_LABELS[t.type]}</Badge>
                </td>
                <td className="px-3 py-2 font-mono tabular-nums text-ink">
                  {formatSen(t.amount)}
                </td>
                <td className="px-3 py-2 text-ink">{t.category ?? '—'}</td>
                <td className="px-3 py-2 text-muted">{t.note ?? ''}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <IconButton label="Edit" onClick={() => openEdit(t)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      label="Delete"
                      variant="destructive"
                      onClick={() => remove(t.id)}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>{total} transactions</span>
        <Pagination page={page} pageCount={pages} onChange={setPage} />
      </div>

      <Drawer
        open={drawerOpen}
        title={editing ? 'Edit transaction' : 'Add transaction'}
        onClose={() => setDrawerOpen(false)}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          {editing ? (
            <p className="text-xs text-muted">
              {TYPE_LABELS[editing.type]} on {editing.date.slice(0, 10)}
            </p>
          ) : (
            <Select
              id="type"
              label="Type"
              value={type}
              onChange={(e) => {
                setType(e.target.value as TransactionType);
                setLinkedEntityId('');
              }}
            >
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
          <Input
            id="amount"
            label="Amount (RM)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          {!editing && (
            <>
              <Input
                id="date"
                label="Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
              {needsAccount && (
                <Select
                  id="account"
                  label="Account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  required
                >
                  <option value="">Select account…</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
              {needsToAccount && (
                <Select
                  id="toAccount"
                  label="To account"
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  required
                >
                  <option value="">To account…</option>
                  {banks
                    .filter((b) => b.id !== accountId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </Select>
              )}
              {needsCategory && (
                <Select
                  id="category"
                  label="Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
              {linkedOptions.length > 0 && (
                <Select
                  id="linkedEntity"
                  label="Linked to"
                  value={linkedEntityId}
                  onChange={(e) => setLinkedEntityId(e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  {linkedOptions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
              <Input
                id="note"
                label="Note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </>
          )}
          <Button type="submit" className="w-full">
            {editing ? 'Save' : 'Add'}
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
