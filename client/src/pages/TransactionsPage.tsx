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

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    const sen = parseRM(amount);
    if (sen === null) return setError('Invalid amount.');
    try {
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
      setAmount('');
      setNote('');
      await Promise.all([loadList(), loadRefs()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function editAmount(t: TransactionDto) {
    const input = window.prompt('New amount (RM)?', (t.amount / 100).toFixed(2));
    if (!input) return;
    const sen = parseRM(input);
    if (sen === null) return setError('Invalid amount.');
    try {
      await api(`/transactions/${t.id}`, { method: 'PATCH', body: { amount: sen } });
      await Promise.all([loadList(), loadRefs()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Edit failed.');
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
    <main>
      <h1>Transactions</h1>
      {error && <p role="alert">{error}</p>}

      <section>
        <h2>Add transaction</h2>
        <form onSubmit={add}>
          <select
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
          </select>
          <input
            placeholder="Amount (RM)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          {needsAccount && (
            <select
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
            </select>
          )}
          {needsToAccount && (
            <select
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
            </select>
          )}
          {needsCategory && (
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {linkedOptions.length > 0 && (
            <select
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
            </select>
          )}
          <input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit">Add</button>
        </form>
      </section>

      <section>
        <h2>History</h2>
        <select
          value={filterType}
          onChange={(e) => {
            setPage(1);
            setFilterType(e.target.value);
          }}
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Category</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>{t.date.slice(0, 10)}</td>
                <td>{TYPE_LABELS[t.type]}</td>
                <td>{formatSen(t.amount)}</td>
                <td>{t.category ?? '—'}</td>
                <td>{t.note ?? ''}</td>
                <td>
                  <button onClick={() => editAmount(t)}>Edit</button>{' '}
                  <button onClick={() => remove(t.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Page {page} of {pages} ({total} transactions){' '}
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Prev
          </button>{' '}
          <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </p>
      </section>
    </main>
  );
}
