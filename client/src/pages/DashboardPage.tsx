import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
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

const theme = vizTheme();
setupCharts(theme);

function senTicks(value: unknown): string {
  return `RM ${(Number(value) / 100).toLocaleString()}`;
}

const senTooltip = {
  callbacks: {
    label: (ctx: any) => {
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

  if (!summary) return <main>Loading…</main>;

  return (
    <main>
      <h1>Dashboard</h1>

      {/* 1. Net worth stat tiles */}
      <section style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: theme.muted, fontSize: 13 }}>Net worth</div>
          <div style={{ fontSize: 32, fontWeight: 600 }}>
            {formatSen(summary.netWorth)}
          </div>
        </div>
        <div>
          <div style={{ color: theme.muted, fontSize: 13 }}>Assets</div>
          <div style={{ fontSize: 20 }}>{formatSen(summary.assets)}</div>
        </div>
        <div>
          <div style={{ color: theme.muted, fontSize: 13 }}>Liabilities</div>
          <div style={{ fontSize: 20 }}>{formatSen(summary.liabilities)}</div>
        </div>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
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
            <p style={{ color: theme.muted }}>Nothing due. 🎉</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 16, overflowY: 'auto', maxHeight: 200 }}>
              {bills.map((b, i) => (
                <li key={i}>
                  <strong>{STATUS_LABEL[b.status]}</strong> —{' '}
                  {b.dueDate.slice(0, 10)}: {b.name} {formatSen(b.amount)}
                </li>
              ))}
            </ul>
          )}
        </ChartCard>

        {/* 5. Spending by category (current month) */}
        <ChartCard title="Spending by category (this month)">
          {categories.length === 0 ? (
            <p style={{ color: theme.muted }}>No expenses recorded yet.</p>
          ) : (
            <div style={{ display: 'flex', gap: 12, height: '100%' }}>
              <div style={{ flex: 1, position: 'relative' }}>
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
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: 13 }}>
                {categories.map((c) => (
                  <li key={c.category}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: categoryColor(c.category, theme),
                        marginRight: 6,
                      }}
                    />
                    {c.category}: {formatSen(c.total)}
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

        {/* Debt overview (widget 7a: stat + composition) */}
        <ChartCard title="Debt overview">
          <div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>
              {formatSen(summary.liabilities)}
            </div>
            <ul style={{ paddingLeft: 16 }}>
              <li>Loans: {formatSen(summary.loanTotal)}</li>
              <li>Credit cards: {formatSen(summary.cardTotal)}</li>
            </ul>
            <p style={{ fontSize: 13 }}>
              <Link to="/loans">Loans</Link> ·{' '}
              <Link to="/credit-cards">Credit cards</Link>
            </p>
          </div>
        </ChartCard>
      </div>

      {/* 7. Recent transactions */}
      <section style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14 }}>
          Recent transactions — <Link to="/transactions">view all</Link>
        </h2>
        <table>
          <tbody>
            {recent.map((t) => (
              <tr key={t.id}>
                <td>{t.date.slice(0, 10)}</td>
                <td>{t.type}</td>
                <td>{formatSen(t.amount)}</td>
                <td>{t.category ?? t.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
