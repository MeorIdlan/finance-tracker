# Plan 3 of 3: Dashboard + Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 7-widget analytics dashboard (Chart.js) backed by aggregation endpoints, plus production deployment: Docker images, nginx, docker-compose.prod.yml, and a Cloudflare Tunnel runbook for the DigitalOcean droplet.

**Architecture:** A `DashboardModule` computes aggregates server-side (Mongo aggregations + a lazily-upserted monthly `NetWorthSnapshot` for the trend line). The client gets a small viz theme layer (validated palette, light/dark, Chart.js defaults) and a widget grid on `/dashboard`. Production runs four compose services — mongo (replica set), server (NestJS image), client (nginx serving the built SPA and proxying `/api`), cloudflared (tunnel to the Cloudflare-managed domain).

**Tech Stack:** Adds `chart.js` 4 + `react-chartjs-2` 5. Everything else as Plans 1-2.

**Spec:** `docs/superpowers/specs/2026-07-12-finance-tracker-design.md`. Prerequisites: Plans 1 and 2 fully implemented.

## Global Constraints

- All Plan 1 and Plan 2 global constraints still apply (money = integer sen, ownership scoping, `/api` prefix, full-scope sessions).
- **"Spending"** in dashboard aggregates = transaction types `expense` + `commitmentPayment` + `cardCharge` (consumption). `loanPayment`, `cardPayment` (debt settlement), `transfer`, and `income` are excluded — settling a card must not double-count the original `cardCharge`.
- **Net worth** = (bank balances + latest savings/investment snapshot values) − (loan balances + credit card current balances).
- Chart colors come from the validated palette below — series slots are assigned in **fixed order, never cycled or reordered by value**; expense categories always map to the same slot (EXPENSE_CATEGORIES index → slot index). Single-series charts show no legend. Never a dual-axis chart. Axis/label text uses ink tokens, never series colors.
- Palette (light / dark), validated for CVD safety in this order:
  slots `#2a78d6/#3987e5`, `#1baf7a/#199e70`, `#eda100/#c98500`, `#008300/#008300`, `#4a3aa7/#9085e9`, `#e34948/#e66767`, `#e87ba4/#d55181`, `#eb6834/#d95926`; surfaces `#fcfcfb/#1a1a19`; grid `#e1e0d9/#2c2c2a`; ink `#0b0b0b/#ffffff`, secondary `#52514e/#c3c2b7`, muted `#898781`.
- Donut/stacked fills carry a 2px surface-colored border as the segment spacer.
- Production env deltas: `COOKIE_SECURE=true`, `WEBAUTHN_RP_ID=<your-domain>`, `WEBAUTHN_ORIGIN=https://<your-domain>`, Mongo not exposed on a public port.

---

### Task 1: Dashboard summary, balances, upcoming bills, recent transactions endpoints

**Files:**
- Create: `server/src/dashboard/dashboard.module.ts`, `server/src/dashboard/dashboard.service.ts`, `server/src/dashboard/dashboard.controller.ts`
- Modify: `shared/src/index.ts` (append dashboard types), `server/src/app.module.ts` (import DashboardModule)
- Test: `server/test/dashboard-summary.e2e.spec.ts`

**Interfaces:**
- Consumes: all financial models, `commitmentStatus` + `nextDueDateFrom` from `common/dates.ts`, `TransactionsService.list`, `CreditCardsService.list` (to trigger lazy statement roll).
- Produces shared types:
  - `DashboardSummary { bankTotal, savingsTotal, loanTotal, cardTotal, assets, liabilities, netWorth }` (all sen)
  - `BalanceSlice { name: string; kind: 'bank' | 'savings' | 'investment'; value: number }`
  - `UpcomingBill { source: 'commitment' | 'creditCard'; name: string; amount: number; dueDate: string; status: CommitmentStatus }`
  - `MonthPoint { month: string; value: number }` and `CategoryTotal { category: ExpenseCategory; total: number }` (used in Task 2)
- Produces endpoints (all `AuthGuard`-protected):
  - `GET /api/dashboard/summary` → `DashboardSummary`
  - `GET /api/dashboard/balances` → `BalanceSlice[]`
  - `GET /api/dashboard/upcoming-bills?days=14` → `UpcomingBill[]` sorted by dueDate; includes overdue and due-within-window active commitments, plus credit cards with `statementBalance > 0` (dueDate = next occurrence of `dueDay`)
  - `GET /api/dashboard/recent-transactions?limit=10` → `TransactionDto[]`
- Produces service method `DashboardService.computeSummary(userId): Promise<DashboardSummary>` (reused by Task 2's snapshot upsert).

- [ ] **Step 1: Append the shared types**

Append to `shared/src/index.ts`:
```ts
// ---- Dashboard DTOs (Plan 3) ----

export interface DashboardSummary {
  bankTotal: number;
  savingsTotal: number;
  loanTotal: number;
  cardTotal: number;
  assets: number;
  liabilities: number;
  netWorth: number;
}

export interface BalanceSlice {
  name: string;
  kind: 'bank' | 'savings' | 'investment';
  value: number;
}

export interface UpcomingBill {
  source: 'commitment' | 'creditCard';
  name: string;
  amount: number;
  dueDate: string;
  status: CommitmentStatus;
}

export interface MonthPoint {
  month: string; // "2026-07"
  value: number;
}

export interface CategoryTotal {
  category: ExpenseCategory;
  total: number;
}
```
Run `npm run build:shared`.

- [ ] **Step 2: Write the failing e2e test**

`server/test/dashboard-summary.e2e.spec.ts`:
```ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('dashboard summary endpoints', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'dash@user.com'));
    const server = ctx.app.getHttpServer();

    const bank = (
      await request(server)
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Main', openingBalance: 500000 })
    ).body;
    const sav = (
      await request(server)
        .post('/api/accounts/savings')
        .set('Cookie', cookie)
        .send({ name: 'ASB', type: 'investment' })
    ).body;
    await request(server)
      .post(`/api/accounts/savings/${sav.id}/snapshots`)
      .set('Cookie', cookie)
      .send({ date: '2026-07-01', value: 1000000 });
    await request(server)
      .post('/api/loans')
      .set('Cookie', cookie)
      .send({ name: 'Car', principal: 300000, interestRate: 3 });
    const card = (
      await request(server)
        .post('/api/credit-cards')
        .set('Cookie', cookie)
        .send({ name: 'Visa', creditLimit: 1000000, statementDay: 5, dueDay: 25 })
    ).body;
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'cardCharge',
        amount: 40000,
        date: new Date().toISOString().slice(0, 10),
        linkedEntityId: card.id,
      });
    await request(server)
      .post('/api/commitments')
      .set('Cookie', cookie)
      .send({ name: 'Rent', amount: 150000, dueDayOfMonth: 1 });
    // one recent expense
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 2500,
        date: new Date().toISOString().slice(0, 10),
        accountId: bank.id,
        category: 'Food',
      });
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('computes the summary', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/summary')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.bankTotal).toBe(497500); // 500000 - 2500 expense
    expect(res.body.savingsTotal).toBe(1000000);
    expect(res.body.loanTotal).toBe(300000);
    expect(res.body.cardTotal).toBe(40000);
    expect(res.body.assets).toBe(1497500);
    expect(res.body.liabilities).toBe(340000);
    expect(res.body.netWorth).toBe(1157500);
  });

  it('lists balance slices for banks and savings', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/balances')
      .set('Cookie', cookie)
      .expect(200);
    const kinds = res.body.map((s: { kind: string }) => s.kind).sort();
    expect(kinds).toEqual(['bank', 'investment']);
  });

  it('lists upcoming bills including the commitment', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/upcoming-bills?days=45')
      .set('Cookie', cookie)
      .expect(200);
    const names = res.body.map((b: { name: string }) => b.name);
    expect(names).toContain('Rent');
    for (const bill of res.body) {
      expect(['overdue', 'dueSoon', 'upcoming']).toContain(bill.status);
    }
  });

  it('returns recent transactions newest first', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/recent-transactions?limit=5')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0].date >= res.body[1].date).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --workspace server -- dashboard-summary`
Expected: FAIL — 404 on `/api/dashboard/summary`.

- [ ] **Step 4: Implement the service, controller, module**

`server/src/dashboard/dashboard.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BalanceSlice,
  DashboardSummary,
  TransactionDto,
  UpcomingBill,
} from '@finance/shared';
import { BankAccount } from '../database/schemas/bank-account.schema';
import { SavingsAccount } from '../database/schemas/savings-account.schema';
import { ValueSnapshot } from '../database/schemas/value-snapshot.schema';
import { Commitment } from '../database/schemas/commitment.schema';
import { Loan } from '../database/schemas/loan.schema';
import { CreditCard } from '../database/schemas/credit-card.schema';
import { commitmentStatus, nextDueDateFrom } from '../common/dates';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { TransactionsService } from '../transactions/transactions.service';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(BankAccount.name) private bankModel: Model<BankAccount>,
    @InjectModel(SavingsAccount.name)
    private savingsModel: Model<SavingsAccount>,
    @InjectModel(ValueSnapshot.name)
    private snapshotModel: Model<ValueSnapshot>,
    @InjectModel(Commitment.name) private commitmentModel: Model<Commitment>,
    @InjectModel(Loan.name) private loanModel: Model<Loan>,
    @InjectModel(CreditCard.name) private cardModel: Model<CreditCard>,
    private cards: CreditCardsService,
    private transactions: TransactionsService,
  ) {}

  private async savingsTotal(userId: Types.ObjectId): Promise<number> {
    const accounts = await this.savingsModel.find({ userId });
    let total = 0;
    for (const acc of accounts) {
      const latest = await this.snapshotModel
        .findOne({ accountId: acc._id })
        .sort({ date: -1 });
      total += latest?.value ?? 0;
    }
    return total;
  }

  private async sumField(
    model: Model<BankAccount> | Model<Loan> | Model<CreditCard>,
    userId: Types.ObjectId,
    field: string,
  ): Promise<number> {
    const [row] = await model.aggregate<{ total: number }>([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: `$${field}` } } },
    ]);
    return row?.total ?? 0;
  }

  async computeSummary(userId: string): Promise<DashboardSummary> {
    const uid = new Types.ObjectId(userId);
    // trigger the lazy statement roll before summing card balances
    await this.cards.list(userId);
    const [bankTotal, savingsTotal, loanTotal, cardTotal] = await Promise.all([
      this.sumField(this.bankModel, uid, 'currentBalance'),
      this.savingsTotal(uid),
      this.sumField(this.loanModel, uid, 'currentBalance'),
      this.sumField(this.cardModel, uid, 'currentBalance'),
    ]);
    const assets = bankTotal + savingsTotal;
    const liabilities = loanTotal + cardTotal;
    return {
      bankTotal,
      savingsTotal,
      loanTotal,
      cardTotal,
      assets,
      liabilities,
      netWorth: assets - liabilities,
    };
  }

  async balances(userId: string): Promise<BalanceSlice[]> {
    const uid = new Types.ObjectId(userId);
    const banks = await this.bankModel.find({ userId: uid });
    const savings = await this.savingsModel.find({ userId: uid });
    const slices: BalanceSlice[] = banks.map((b) => ({
      name: b.name,
      kind: 'bank' as const,
      value: b.currentBalance,
    }));
    for (const s of savings) {
      const latest = await this.snapshotModel
        .findOne({ accountId: s._id })
        .sort({ date: -1 });
      slices.push({ name: s.name, kind: s.type, value: latest?.value ?? 0 });
    }
    return slices;
  }

  async upcomingBills(userId: string, days: number): Promise<UpcomingBill[]> {
    const uid = new Types.ObjectId(userId);
    const horizon = new Date(Date.now() + days * 24 * 3600 * 1000);
    const bills: UpcomingBill[] = [];

    const commitments = await this.commitmentModel.find({
      userId: uid,
      active: true,
      nextDueDate: { $lte: horizon },
    });
    for (const c of commitments) {
      bills.push({
        source: 'commitment',
        name: c.name,
        amount: c.amount,
        dueDate: c.nextDueDate.toISOString(),
        status: commitmentStatus(c.nextDueDate),
      });
    }

    await this.cards.list(userId); // lazy statement roll
    const cards = await this.cardModel.find({
      userId: uid,
      statementBalance: { $gt: 0 },
    });
    for (const card of cards) {
      const dueDate = nextDueDateFrom(card.dueDay);
      if (dueDate <= horizon) {
        bills.push({
          source: 'creditCard',
          name: card.name,
          amount: card.statementBalance,
          dueDate: dueDate.toISOString(),
          status: commitmentStatus(dueDate),
        });
      }
    }

    return bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  async recentTransactions(
    userId: string,
    limit: number,
  ): Promise<TransactionDto[]> {
    const page = await this.transactions.list(userId, {
      page: '1',
      pageSize: String(Math.min(50, Math.max(1, limit))),
    });
    return page.items;
  }
}
```

`server/src/dashboard/dashboard.controller.ts`:
```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/session.service';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private service: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() user: RequestUser) {
    return this.service.computeSummary(user.userId);
  }

  @Get('balances')
  balances(@CurrentUser() user: RequestUser) {
    return this.service.balances(user.userId);
  }

  @Get('upcoming-bills')
  upcomingBills(
    @CurrentUser() user: RequestUser,
    @Query('days') days = '14',
  ) {
    const d = Math.min(90, Math.max(1, parseInt(days, 10) || 14));
    return this.service.upcomingBills(user.userId, d);
  }

  @Get('recent-transactions')
  recent(@CurrentUser() user: RequestUser, @Query('limit') limit = '10') {
    return this.service.recentTransactions(
      user.userId,
      parseInt(limit, 10) || 10,
    );
  }
}
```

`server/src/dashboard/dashboard.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreditCardsModule } from '../credit-cards/credit-cards.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [AuthModule, CreditCardsModule, TransactionsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

Add `DashboardModule` to `server/src/app.module.ts` imports.

- [ ] **Step 5: Run tests and commit**

Run: `npm test --workspace server -- dashboard-summary`
Expected: PASS (4 tests).

```bash
git add shared/src/index.ts server/src/dashboard/ server/src/app.module.ts server/test/dashboard-summary.e2e.spec.ts
git commit -m "feat(server): add dashboard summary, balances, upcoming bills, recent transactions"
```

---

### Task 2: Trend endpoints — net worth snapshots, spending by category, spending trend

**Files:**
- Create: `server/src/database/schemas/net-worth-snapshot.schema.ts`
- Modify: `server/src/database/database.module.ts` (register it), `server/src/dashboard/dashboard.service.ts`, `server/src/dashboard/dashboard.controller.ts`
- Test: `server/test/dashboard-trends.e2e.spec.ts`

**Interfaces:**
- Consumes: `Transaction` model aggregations, `computeSummary` from Task 1.
- Produces:
  - `NetWorthSnapshot { userId, month: 'YYYY-MM', value, computedAt }`, unique index `(userId, month)`.
  - `GET /api/dashboard/net-worth-trend` → `MonthPoint[]` ascending by month (max 24). Lazily upserts the current month's snapshot (from `computeSummary`) on every call, so the trend accrues one point per month of actual use.
  - `GET /api/dashboard/spending-by-category?month=YYYY-MM` → `CategoryTotal[]` (expense type only, given month, defaults to current month; categories in EXPENSE_CATEGORIES order, zero categories omitted).
  - `GET /api/dashboard/spending-trend?months=12` → `MonthPoint[]` ascending (spending = expense + commitmentPayment + cardCharge, grouped by month).

- [ ] **Step 1: Write the failing e2e test**

`server/test/dashboard-trends.e2e.spec.ts`:
```ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('dashboard trend endpoints', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  const thisMonth = new Date().toISOString().slice(0, 7);

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'trend@user.com'));
    const server = ctx.app.getHttpServer();
    const bank = (
      await request(server)
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Main', openingBalance: 1000000 })
    ).body;
    const today = new Date().toISOString().slice(0, 10);
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'expense', amount: 3000, date: today, accountId: bank.id, category: 'Food' });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'expense', amount: 2000, date: today, accountId: bank.id, category: 'Food' });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'expense', amount: 7000, date: today, accountId: bank.id, category: 'Transport' });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'income', amount: 99999, date: today, accountId: bank.id });
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('spending by category sums expenses only, in category order', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/dashboard/spending-by-category?month=${thisMonth}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toEqual([
      { category: 'Food', total: 5000 },
      { category: 'Transport', total: 7000 },
    ]);
  });

  it('spending trend groups by month and excludes income', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/spending-trend?months=3')
      .set('Cookie', cookie)
      .expect(200);
    const current = res.body.find(
      (p: { month: string }) => p.month === thisMonth,
    );
    expect(current.value).toBe(12000);
  });

  it('net worth trend lazily records the current month', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/net-worth-trend')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].month).toBe(thisMonth);
    // 1,000,000 - 12,000 spending + 99,999 income
    expect(res.body[0].value).toBe(1087999);

    // calling again updates rather than duplicates
    const again = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/net-worth-trend')
      .set('Cookie', cookie);
    expect(again.body).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- dashboard-trends`
Expected: FAIL — 404 on the trend routes.

- [ ] **Step 3: Add the schema**

`server/src/database/schemas/net-worth-snapshot.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NetWorthSnapshotDocument = HydratedDocument<NetWorthSnapshot>;

@Schema()
export class NetWorthSnapshot {
  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  month: string; // "2026-07"

  @Prop({ required: true })
  value: number; // integer sen

  @Prop({ default: () => new Date() })
  computedAt: Date;
}

export const NetWorthSnapshotSchema =
  SchemaFactory.createForClass(NetWorthSnapshot);
NetWorthSnapshotSchema.index({ userId: 1, month: 1 }, { unique: true });
```
Register it in `database.module.ts` like the others.

- [ ] **Step 4: Add the service methods and routes**

Append to `server/src/dashboard/dashboard.service.ts` (add `NetWorthSnapshot` model injection and `EXPENSE_CATEGORIES`, `CategoryTotal`, `MonthPoint` imports from `@finance/shared`):
```ts
  async netWorthTrend(userId: string): Promise<MonthPoint[]> {
    const uid = new Types.ObjectId(userId);
    const month = new Date().toISOString().slice(0, 7);
    const summary = await this.computeSummary(userId);
    await this.netWorthModel.updateOne(
      { userId: uid, month },
      { value: summary.netWorth, computedAt: new Date() },
      { upsert: true },
    );
    const points = await this.netWorthModel
      .find({ userId: uid })
      .sort({ month: 1 })
      .limit(24);
    return points.map((p) => ({ month: p.month, value: p.value }));
  }

  async spendingByCategory(
    userId: string,
    month: string,
  ): Promise<CategoryTotal[]> {
    const start = new Date(`${month}-01T00:00:00Z`);
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    );
    const rows = await this.txnModel.aggregate<{
      _id: string;
      total: number;
    }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          type: 'expense',
          date: { $gte: start, $lt: end },
        },
      },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
    ]);
    const byCategory = new Map(rows.map((r) => [r._id, r.total]));
    return EXPENSE_CATEGORIES.filter((c) => byCategory.has(c)).map((c) => ({
      category: c,
      total: byCategory.get(c)!,
    }));
  }

  async spendingTrend(userId: string, months: number): Promise<MonthPoint[]> {
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
    );
    const rows = await this.txnModel.aggregate<{
      _id: string;
      total: number;
    }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          type: { $in: ['expense', 'commitmentPayment', 'cardCharge'] },
          date: { $gte: start },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((r) => ({ month: r._id, value: r.total }));
  }
```
Constructor additions: `@InjectModel(NetWorthSnapshot.name) private netWorthModel: Model<NetWorthSnapshot>` and `@InjectModel(Transaction.name) private txnModel: Model<Transaction>` (with schema imports).

Append to `server/src/dashboard/dashboard.controller.ts`:
```ts
  @Get('net-worth-trend')
  netWorthTrend(@CurrentUser() user: RequestUser) {
    return this.service.netWorthTrend(user.userId);
  }

  @Get('spending-by-category')
  spendingByCategory(
    @CurrentUser() user: RequestUser,
    @Query('month') month?: string,
  ) {
    const m =
      month && /^\d{4}-\d{2}$/.test(month)
        ? month
        : new Date().toISOString().slice(0, 7);
    return this.service.spendingByCategory(user.userId, m);
  }

  @Get('spending-trend')
  spendingTrend(
    @CurrentUser() user: RequestUser,
    @Query('months') months = '12',
  ) {
    const m = Math.min(36, Math.max(1, parseInt(months, 10) || 12));
    return this.service.spendingTrend(user.userId, m);
  }
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test --workspace server`
Expected: full suite PASS.

```bash
git add server/src/database/ server/src/dashboard/ server/test/dashboard-trends.e2e.spec.ts
git commit -m "feat(server): add net worth trend, spending by category, and spending trend"
```

---

### Task 3: Client chart foundations (Chart.js + viz theme)

**Files:**
- Create: `client/src/viz/theme.ts`, `client/src/viz/setup.ts`, `client/src/viz/ChartCard.tsx`
- Modify: `client/package.json` (add chart.js + react-chartjs-2)

**Interfaces:**
- Consumes: nothing new server-side.
- Produces:
  - `vizTheme(): VizTheme` — resolves light/dark from `prefers-color-scheme`; `VizTheme { surface, ink, inkSecondary, muted, grid, axis, series: string[] }` with the validated palette (fixed slot order — callers index into `series`, never reorder it).
  - `setupCharts(theme: VizTheme): void` — registers Chart.js components once and sets global defaults (system font, muted tick color, hairline grid, tooltips enabled, no dual axes anywhere).
  - `ChartCard({ title, children })` — titled card wrapper with fixed chart height.
  - `categoryColor(category: ExpenseCategory, theme: VizTheme): string` — stable EXPENSE_CATEGORIES-index → series-slot mapping.

- [ ] **Step 1: Install the chart dependencies**

Add to `client/package.json` dependencies:
```json
    "chart.js": "^4.4.0",
    "react-chartjs-2": "^5.2.0",
```
Run: `npm install` (from repo root).

- [ ] **Step 2: Write the theme and setup**

`client/src/viz/theme.ts`:
```ts
import { EXPENSE_CATEGORIES, ExpenseCategory } from '@finance/shared';

export interface VizTheme {
  surface: string;
  ink: string;
  inkSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  series: string[];
}

// Validated palette (CVD-safe in this slot order — never reorder or cycle).
const LIGHT: VizTheme = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  inkSecondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  series: [
    '#2a78d6',
    '#1baf7a',
    '#eda100',
    '#008300',
    '#4a3aa7',
    '#e34948',
    '#e87ba4',
    '#eb6834',
  ],
};

const DARK: VizTheme = {
  surface: '#1a1a19',
  ink: '#ffffff',
  inkSecondary: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
  series: [
    '#3987e5',
    '#199e70',
    '#c98500',
    '#008300',
    '#9085e9',
    '#e66767',
    '#d55181',
    '#d95926',
  ],
};

export function vizTheme(): VizTheme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? DARK
    : LIGHT;
}

// Category identity is stable: EXPENSE_CATEGORIES index -> series slot.
export function categoryColor(
  category: ExpenseCategory,
  theme: VizTheme,
): string {
  const idx = EXPENSE_CATEGORIES.indexOf(category);
  return theme.series[idx % theme.series.length];
}
```

`client/src/viz/setup.ts`:
```ts
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { VizTheme } from './theme';

let registered = false;

export function setupCharts(theme: VizTheme): void {
  if (!registered) {
    ChartJS.register(
      ArcElement,
      BarElement,
      CategoryScale,
      LinearScale,
      LineElement,
      PointElement,
      Filler,
      Legend,
      Tooltip,
    );
    registered = true;
  }
  ChartJS.defaults.font.family =
    'system-ui, -apple-system, "Segoe UI", sans-serif';
  ChartJS.defaults.color = theme.muted;
  ChartJS.defaults.borderColor = theme.grid;
  ChartJS.defaults.plugins.legend.labels.boxWidth = 12;
}
```

`client/src/viz/ChartCard.tsx`:
```tsx
import { ReactNode } from 'react';

export default function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        border: '1px solid rgba(11,11,11,0.10)',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <h2 style={{ fontSize: 14, marginTop: 0 }}>{title}</h2>
      <div style={{ height: 220, position: 'relative' }}>{children}</div>
    </section>
  );
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm run build --workspace client`
Expected: clean type-check with chart.js installed.

```bash
git add client/package.json client/src/viz/ package-lock.json
git commit -m "feat(client): add Chart.js setup with validated viz theme"
```

---

### Task 4: Dashboard page with the 7 widgets

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx` (full replacement)

**Interfaces:**
- Consumes: all `/api/dashboard/*` endpoints, viz foundations from Task 3, `formatSen`, DTOs from `@finance/shared`.
- Produces the 7 widgets in a responsive grid:
  1. Net worth stat tiles (net worth hero + assets/liabilities) — stat tiles, no chart chrome.
  2. Net worth trend — single-series line, no legend.
  3. Account balances — doughnut, one slot per account (2px surface-gap borders), legend + sen values in tooltips.
  4. Upcoming bills — list with status text labels (never color alone).
  5. Spending by category — doughnut with stable category→slot colors and a visible value list beside it (relief for low-contrast slots).
  6. Spending trend — single-series bar by month, no legend.
  7. Recent transactions — table, linking to `/transactions`.

- [ ] **Step 1: Replace DashboardPage**

`client/src/pages/DashboardPage.tsx`:
```tsx
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
    label: (ctx: { parsed: { y?: number } | number; label?: string }) => {
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
```

- [ ] **Step 2: Verify and commit**

Run: `npm run build --workspace client && npm test --workspace client`
Expected: clean.
Manual: with seeded data from Plan 2's smoke test, open `/dashboard` and check all widgets render, tooltips show RM values, and the layout works at ~375px width (grid collapses to one column). Toggle OS dark mode and reload — charts re-theme.

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "feat(client): add dashboard with 7 analytics widgets"
```

---

### Task 5: Production images and docker-compose.prod.yml

**Files:**
- Create: `server/Dockerfile`, `client/Dockerfile`, `client/nginx.conf`, `docker-compose.prod.yml`, `.dockerignore`

**Interfaces:**
- Consumes: the whole monorepo build.
- Produces: `docker compose -f docker-compose.prod.yml up -d --build` runs the full stack on one host. Services: `mongo` (replica set, internal-only), `server` (NestJS, internal-only), `client` (nginx on port 80, serves SPA + proxies `/api` → `server:3000`), `cloudflared` (outbound tunnel; no inbound ports exposed at all).

- [ ] **Step 1: Write .dockerignore**

`.dockerignore`:
```
node_modules
**/node_modules
**/dist
.git
.env
docs
```

- [ ] **Step 2: Write the server Dockerfile**

`server/Dockerfile` (build context is the repo root):
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY shared shared
COPY server server
RUN npm run build --workspace shared && npm run build --workspace server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
EXPOSE 3000
CMD ["node", "server/dist/main.js"]
```

Note: `client/package.json` is copied only so `npm ci` can resolve the workspace tree; no client code is built here.

- [ ] **Step 3: Write the client Dockerfile and nginx.conf**

`client/nginx.conf`:
```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://server:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri /index.html;
  }
}
```

`client/Dockerfile` (build context is the repo root):
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY shared shared
COPY client client
RUN npm run build --workspace shared && npm run build --workspace client

FROM nginx:alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 4: Write docker-compose.prod.yml**

`docker-compose.prod.yml`:
```yaml
services:
  mongo:
    image: mongo:8
    restart: unless-stopped
    command: ["--replSet", "rs0", "--bind_ip_all"]
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: ["CMD-SHELL", "mongosh --quiet --eval 'try { rs.status().ok } catch (e) { rs.initiate().ok }'"]
      interval: 5s
      timeout: 30s
      retries: 30

  server:
    build:
      context: .
      dockerfile: server/Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      MONGODB_URI: mongodb://mongo:27017/finance-tracker?replicaSet=rs0&directConnection=true
      COOKIE_SECURE: "true"
    depends_on:
      mongo:
        condition: service_healthy

  client:
    build:
      context: .
      dockerfile: client/Dockerfile
    restart: unless-stopped
    depends_on:
      - server

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel run --token ${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      - client

volumes:
  mongo-data:
```

Note: no `ports:` anywhere — Cloudflare Tunnel reaches `client` over the compose network, and nothing listens on the droplet's public interface.

- [ ] **Step 5: Verify the build locally**

Run: `docker compose -f docker-compose.prod.yml build`
Expected: both images build cleanly.
Run (optional local smoke): temporarily add `ports: ["8080:80"]` to `client`, `docker compose -f docker-compose.prod.yml up -d mongo server client`, browse `http://localhost:8080` — login page loads and `/api/health` returns ok (WebAuthn itself won't pass on a non-localhost origin without the real domain; that is expected). Remove the port mapping afterwards.

- [ ] **Step 6: Commit**

```bash
git add server/Dockerfile client/Dockerfile client/nginx.conf docker-compose.prod.yml .dockerignore
git commit -m "chore: add production Docker images and compose stack with cloudflared"
```

---

### Task 6: Deployment runbook + production smoke checklist

**Files:**
- Create: `docs/deployment.md`
- Modify: `README.md` (link to it), `.env.example` (document production deltas)

**Interfaces:**
- Consumes: Task 5's compose stack.
- Produces: a step-by-step runbook a future you can follow verbatim, and the recorded production smoke checklist.

- [ ] **Step 1: Append production notes to .env.example**

Append:
```
# --- Production overrides (docker-compose.prod.yml) ---
# COOKIE_SECURE=true            (set by compose)
# WEBAUTHN_RP_ID=finance.example.com
# WEBAUTHN_ORIGIN=https://finance.example.com
# CLOUDFLARE_TUNNEL_TOKEN=      (from Cloudflare Zero Trust dashboard)
```

- [ ] **Step 2: Write docs/deployment.md**

```markdown
# Deployment: DigitalOcean droplet + Cloudflare Tunnel

## One-time setup

1. **Droplet**: Ubuntu LTS, 1 GB+ RAM. Install Docker Engine + compose plugin
   (`https://docs.docker.com/engine/install/ubuntu/`). Create a non-root user
   in the `docker` group.
2. **Clone**: `git clone <repo> && cd finance-tracker`.
3. **Env**: `cp .env.example .env`, then set real values:
   - `MAILERSEND_API_KEY`, `MAILERSEND_FROM_EMAIL` (a verified sender domain)
   - `WEBAUTHN_RP_ID=finance.example.com` (bare domain, no scheme)
   - `WEBAUTHN_ORIGIN=https://finance.example.com`
   - `CLOUDFLARE_TUNNEL_TOKEN` (next step)
   MONGODB_URI and COOKIE_SECURE are set by docker-compose.prod.yml.
4. **Tunnel**: Cloudflare dashboard → Zero Trust → Networks → Tunnels →
   Create a tunnel (Cloudflared connector). Copy the token into `.env`.
   Add a Public Hostname: `finance.example.com` → Service `HTTP` →
   URL `client:80`. Cloudflare creates the DNS record automatically.
5. **Start**: `docker compose -f docker-compose.prod.yml up -d --build`.

## Updating

    git pull
    docker compose -f docker-compose.prod.yml up -d --build

## Backups

Mongo data lives in the `mongo-data` volume. Snapshot with:

    docker compose -f docker-compose.prod.yml exec mongo \
      mongodump --archive --db finance-tracker > backup-$(date +%F).archive

Restore with `mongorestore --archive < backup-YYYY-MM-DD.archive` (exec'd the
same way). Keep backups off-droplet.

## Production smoke checklist

- [ ] `https://finance.example.com` loads the login page over HTTPS
- [ ] Register a new account: OTP email arrives, passkey created on a phone
      or laptop (real domain → platform authenticators work)
- [ ] `document.cookie` does not expose `sid`; DevTools shows the cookie as
      HttpOnly + Secure
- [ ] Log out, log back in with the passkey
- [ ] Add a second passkey from another device via Settings
- [ ] Create a bank account + one transaction of each type; balances update
- [ ] Dashboard renders all 7 widgets with data
- [ ] `docker compose -f docker-compose.prod.yml restart` — session survives
      (sessions are in Mongo, not memory)
- [ ] Backup command produces a non-empty archive

## Troubleshooting

- **Passkey prompt fails with "invalid domain"**: `WEBAUTHN_RP_ID` must match
  the public hostname exactly, and the origin must be the `https://` form.
- **OTP emails missing**: check MailerSend dashboard for sender-domain
  verification; check the app's audit log for `auth.otp_requested`; quota
  exhaustion returns a clear 503 from `/api/auth/register`.
- **Mongo "not primary" errors**: the replica set didn't initiate — check
  `docker compose -f docker-compose.prod.yml ps` shows mongo healthy; the
  healthcheck runs `rs.initiate()` automatically.
```

- [ ] **Step 3: Link from README and commit**

Add under the README's Docs section: `- Deployment: docs/deployment.md`.

```bash
git add docs/deployment.md README.md .env.example
git commit -m "docs: add deployment runbook and production smoke checklist"
```

- [ ] **Step 4: Execute the runbook**

Deploy for real following `docs/deployment.md`, then work through the smoke checklist on the live domain. Fix anything that fails and commit the fixes. This is the final acceptance gate for v1.

---

## Out of Scope for Plan 3

- Email reminders, amortization schedules, multi-currency (spec §8 — not v1).
- CI/CD pipeline, monitoring/alerting — add later if the manual update flow gets old.
