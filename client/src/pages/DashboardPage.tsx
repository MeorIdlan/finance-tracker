import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import type { TooltipItem } from 'chart.js';
import {
  BalanceSlice,
  CategoryTotal,
  DashboardSummary,
  MonthPoint,
  TransactionDto,
  UpcomingBill,
} from '@finance/shared';
import { api } from '../api';
import { formatSen } from '../money';
import { categoryColor, vizTheme } from '../viz/theme';
import { setupCharts } from '../viz/setup';
import ChartCard from '../viz/ChartCard';
import Badge from '../components/Badge';

const theme = vizTheme();
setupCharts(theme);

function senTicks(value: unknown): string {
  return formatSen(Number(value));
}

const senTooltip = {
  callbacks: {
    label: (ctx: TooltipItem<any>) => {
      const raw =
        typeof ctx.parsed === 'number' ? ctx.parsed : (ctx.parsed.y ?? 0);
      return ` ${formatSen(raw)}`;
    },
  },
};

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

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [netWorthTrend, setNetWorthTrend] = useState<MonthPoint[]>([]);
  const [balances, setBalances] = useState<BalanceSlice[]>([]);
  const [bills, setBills] = useState<UpcomingBill[]>([]);
  const [categories, setCategories] = useState<CategoryTotal[]>([]);
  const [spendTrend, setSpendTrend] = useState<MonthPoint[]>([]);
  const [recent, setRecent] = useState<TransactionDto[]>([]);

  const load = useCallback(async () => {
    const [s, nw, b, ub, cat, st, rt] = await Promise.all([
      api<DashboardSummary>('/dashboard/summary'),
      api<MonthPoint[]>('/dashboard/net-worth-trend'),
      api<BalanceSlice[]>('/dashboard/balances'),
      api<UpcomingBill[]>('/dashboard/upcoming-bills?days=14'),
      api<CategoryTotal[]>('/dashboard/spending-by-category'),
      api<MonthPoint[]>('/dashboard/spending-trend?months=12'),
      api<TransactionDto[]>('/dashboard/recent-transactions?limit=8'),
    ]);
    setSummary(s);
    setNetWorthTrend(nw);
    setBalances(b);
    setBills(ub);
    setCategories(cat);
    setSpendTrend(st);
    setRecent(rt);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!summary) return <main className="text-sm text-muted">Loading…</main>;

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold">Dashboard</h1>

      {/* 1. Net worth stat tiles */}
      <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted">Net worth</div>
          <div className="font-mono text-2xl font-semibold tabular-nums text-white">
            {formatSen(summary.netWorth)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted">Assets</div>
          <div className="font-mono text-lg tabular-nums text-ink">
            {formatSen(summary.assets)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted">Liabilities</div>
          <div className="font-mono text-lg tabular-nums text-ink">
            {formatSen(summary.liabilities)}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* 2. Net worth trend */}
        <ChartCard title="Net worth over time">
          <Line
            data={{
              labels: netWorthTrend.map((p) => p.month),
              datasets: [
                {
                  data: netWorthTrend.map((p) => p.value),
                  borderColor: theme.series[0],
                  backgroundColor: theme.series[0],
                  borderWidth: 2,
                  pointRadius: 3,
                  tension: 0.2,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: senTooltip },
              scales: { y: { ticks: { callback: senTicks } } },
            }}
          />
        </ChartCard>

        {/* 3. Account balances */}
        <ChartCard title="Account balances">
          <Doughnut
            data={{
              labels: balances.map((b) => `${b.name} (${b.kind})`),
              datasets: [
                {
                  data: balances.map((b) => b.value),
                  backgroundColor: balances.map(
                    (_, i) => theme.series[i % theme.series.length],
                  ),
                  borderColor: theme.surface,
                  borderWidth: 2,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              plugins: { legend: { position: 'right' }, tooltip: senTooltip },
            }}
          />
        </ChartCard>

        {/* 4. Upcoming bills */}
        <ChartCard title="Upcoming bills (14 days)">
          {bills.length === 0 ? (
            <p className="text-sm text-muted">Nothing due. 🎉</p>
          ) : (
            <ul className="max-h-52 space-y-2 overflow-y-auto text-sm">
              {bills.map((b, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span>
                    <Badge tone={STATUS_TONE[b.status]}>
                      {STATUS_LABEL[b.status]}
                    </Badge>{' '}
                    <span className="text-ink">{b.name}</span>{' '}
                    <span className="font-mono text-xs tabular-nums text-muted">{b.dueDate.slice(0, 10)}</span>
                  </span>
                  <span className="font-mono tabular-nums text-ink">
                    {formatSen(b.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>

        {/* 5. Spending by category (current month) */}
        <ChartCard title="Spending by category (this month)">
          {categories.length === 0 ? (
            <p className="text-sm text-muted">No expenses recorded yet.</p>
          ) : (
            <div className="flex h-full gap-3">
              <div className="relative flex-1">
                <Doughnut
                  data={{
                    labels: categories.map((c) => c.category),
                    datasets: [
                      {
                        data: categories.map((c) => c.total),
                        backgroundColor: categories.map((c) =>
                          categoryColor(c.category, theme),
                        ),
                        borderColor: theme.surface,
                        borderWidth: 2,
                      },
                    ],
                  }}
                  options={{
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: senTooltip },
                  }}
                />
              </div>
              {/* visible value list: identity + value never rely on color alone */}
              <ul className="space-y-1 text-xs">
                {categories.map((c) => (
                  <li key={c.category} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ background: categoryColor(c.category, theme) }}
                    />
                    <span className="text-ink">{c.category}:</span>{' '}
                    <span className="font-mono tabular-nums text-muted">
                      {formatSen(c.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartCard>

        {/* 6. Spending trend */}
        <ChartCard title="Monthly spending">
          <Bar
            data={{
              labels: spendTrend.map((p) => p.month),
              datasets: [
                {
                  data: spendTrend.map((p) => p.value),
                  backgroundColor: theme.series[0],
                  borderRadius: 4,
                  maxBarThickness: 24,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: senTooltip },
              scales: { y: { ticks: { callback: senTicks } } },
            }}
          />
        </ChartCard>

        {/* Debt overview */}
        <ChartCard title="Debt overview">
          <div>
            <div className="font-mono text-xl font-semibold tabular-nums text-white">
              {formatSen(summary.liabilities)}
            </div>
            <ul className="mt-2 space-y-1 text-sm text-ink">
              <li>
                Loans:{' '}
                <span className="font-mono tabular-nums">
                  {formatSen(summary.loanTotal)}
                </span>
              </li>
              <li>
                Credit cards:{' '}
                <span className="font-mono tabular-nums">
                  {formatSen(summary.cardTotal)}
                </span>
              </li>
            </ul>
            <p className="mt-3 text-xs">
              <Link to="/loans" className="text-accent hover:underline">
                Loans
              </Link>{' '}
              ·{' '}
              <Link to="/credit-cards" className="text-accent hover:underline">
                Credit cards
              </Link>
            </p>
          </div>
        </ChartCard>
      </div>

      {/* 7. Recent transactions */}
      <section className="mt-6">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          Recent transactions —{' '}
          <Link to="/transactions" className="text-accent hover:underline">
            view all
          </Link>
        </h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              {recent.map((t) => (
                <tr key={t.id} className="border-t border-border first:border-t-0">
                  <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted">
                    {t.date.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-ink">{t.type}</td>
                  <td className="px-3 py-2 font-mono tabular-nums text-ink">
                    {formatSen(t.amount)}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {t.category ?? t.note ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
