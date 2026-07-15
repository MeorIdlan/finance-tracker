# Commitment already-paid flag + generalized payment source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a commitment be created as "already paid this period," and let expenses, commitment payments, and loan payments be sourced from either a bank account or a credit card (replacing the standalone `cardCharge` transaction type), plus expose credit card opening balance in the UI.

**Architecture:** Two independent server-side changes plus their client forms. (1) `CommitmentsService.create()` optionally advances `nextDueDate` one extra period via the existing `shiftDueDate` helper — no new schema field, no transaction created. (2) `Transaction.accountId` is replaced by `sourceType: 'bankAccount' | 'creditCard'` + `sourceId`, `cardCharge` is removed from `TransactionType` (its behavior is now `expense` + `sourceType: 'creditCard'`), and every service/test that reads the old `accountId` field is updated to the new shape.

**Tech Stack:** NestJS + Mongoose (server), React + Vite (client), shared TS types package (`@finance/shared`), Jest + Supertest + mongodb-memory-server (server e2e tests).

## Global Constraints

- All monetary values are integer sen — never floats.
- `shared/src` must be rebuilt (`npm run build:shared`) after any change to it, before server/client code that imports `@finance/shared` will pick it up.
- No production data exists yet — no migration script needed for the `cardCharge` → `expense` change or the `accountId` → `sourceId` rename (confirmed with user).
- Server tests run via `npx jest <path> --workspace server`; there is no separate e2e command — e2e specs (`server/test/*.e2e.spec.ts`) run under the same Jest config as unit specs.
- Client has no page-level test harness (only `client/src/api.spec.ts` / `money.spec.ts` unit tests exist) — client UI changes are verified manually via `npm run dev` + Playwright per CLAUDE.md, not new automated tests.

---

### Task 1: Commitment "already paid this period" flag (server)

**Files:**
- Modify: `server/src/commitments/dto.ts`
- Modify: `server/src/commitments/commitments.service.ts`
- Test: `server/test/commitments.e2e.spec.ts`

**Interfaces:**
- Produces: `CreateCommitmentDto.alreadyPaidThisPeriod?: boolean` — accepted only by `POST /api/commitments`, has no effect on `update()`.

- [ ] **Step 1: Write the failing e2e test**

Add to `server/test/commitments.e2e.spec.ts`, right after the `'creates a commitment with a computed next due date and status'` test (after line 32, before the `'updates amount...'` test):

```ts
  it('alreadyPaidThisPeriod shifts nextDueDate one period beyond a normal commitment', async () => {
    const server = ctx.app.getHttpServer();
    const normal = await request(server)
      .post('/api/commitments')
      .set('Cookie', cookie)
      .send({ name: 'Water', amount: 5000, dueDayOfMonth: 1 })
      .expect(201);
    const paid = await request(server)
      .post('/api/commitments')
      .set('Cookie', cookie)
      .send({
        name: 'Water Paid',
        amount: 5000,
        dueDayOfMonth: 1,
        alreadyPaidThisPeriod: true,
      })
      .expect(201);
    const normalDate = new Date(normal.body.nextDueDate);
    const paidDate = new Date(paid.body.nextDueDate);
    const monthsApart =
      (paidDate.getUTCFullYear() - normalDate.getUTCFullYear()) * 12 +
      (paidDate.getUTCMonth() - normalDate.getUTCMonth());
    expect(monthsApart).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest server/test/commitments.e2e.spec.ts --workspace server -t "alreadyPaidThisPeriod"`
Expected: FAIL — `monthsApart` is `0` because the `alreadyPaidThisPeriod` field is silently stripped by the global `ValidationPipe({ whitelist: true })` (it's not yet declared on `CreateCommitmentDto`), so both commitments get the same `nextDueDate`.

- [ ] **Step 3: Add the field to `CreateCommitmentDto`**

In `server/src/commitments/dto.ts`, add `IsBoolean` is already imported. Add this property to `CreateCommitmentDto` (after `dueDayOfMonth`):

```ts
  @IsOptional()
  @IsBoolean()
  alreadyPaidThisPeriod?: boolean;
```

- [ ] **Step 4: Use the flag in `commitments.service.ts`**

In `server/src/commitments/commitments.service.ts`, change the import line to include `shiftDueDate`:

```ts
import { commitmentStatus, nextDueDateFrom, shiftDueDate } from '../common/dates';
```

Replace the body of `create()`:

```ts
  async create(
    userId: string,
    dto: CreateCommitmentDto,
  ): Promise<CommitmentDto> {
    let nextDueDate = nextDueDateFrom(dto.dueDayOfMonth);
    if (dto.alreadyPaidThisPeriod) {
      nextDueDate = shiftDueDate(nextDueDate, dto.dueDayOfMonth, 1);
    }
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      amount: dto.amount,
      dueDayOfMonth: dto.dueDayOfMonth,
      nextDueDate,
      active: true,
    });
    await this.audit.log({
      userId,
      action: 'commitment.created',
      entityType: 'Commitment',
      entityId: doc._id.toHexString(),
      metadata: { name: dto.name, amount: dto.amount },
    });
    return this.toDto(doc);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest server/test/commitments.e2e.spec.ts --workspace server`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 6: Commit**

```bash
git add server/src/commitments/dto.ts server/src/commitments/commitments.service.ts server/test/commitments.e2e.spec.ts
git commit -m "feat: let a commitment be created as already paid for the current period"
```

---

### Task 2: Commitment "already paid" checkbox (client)

**Files:**
- Modify: `client/src/pages/CommitmentsPage.tsx`

**Interfaces:**
- Consumes: `POST /api/commitments` body now accepts `alreadyPaidThisPeriod?: boolean` (Task 1).

- [ ] **Step 1: Add form state and checkbox**

In `client/src/pages/CommitmentsPage.tsx`, add state near the other form state (after `const [dueDay, setDueDay] = useState('1');`):

```tsx
  const [alreadyPaid, setAlreadyPaid] = useState(false);
```

In `add()`, include the flag in the POST body and reset it on success:

```ts
  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    const sen = parseRM(amount);
    if (sen === null) return setError('Invalid amount.');
    try {
      await api('/commitments', {
        method: 'POST',
        body: {
          name,
          amount: sen,
          dueDayOfMonth: parseInt(dueDay, 10),
          alreadyPaidThisPeriod: alreadyPaid,
        },
      });
      setName('');
      setAmount('');
      setDueDay('1');
      setAlreadyPaid(false);
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }
```

Add the checkbox to the form, right before the submit `<Button>` (after the `dueDay` `<Input>`):

```tsx
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={alreadyPaid}
              onChange={(e) => setAlreadyPaid(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            I've already paid this month
          </label>
```

- [ ] **Step 2: Manually verify in the browser**

Run `npm run dev --workspace server` and `npm run dev --workspace client` (or use the `run` skill). Navigate to the Commitments page, open "Add commitment," check "I've already paid this month," submit, and confirm the new commitment's due date is one month later than an equivalent commitment added without the checkbox. Take a screenshot.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/CommitmentsPage.tsx
git commit -m "feat: add already-paid checkbox to the add-commitment form"
```

---

### Task 3: Shared types — `SourceType`, drop `cardCharge`, update `TransactionDto`

**Files:**
- Modify: `shared/src/index.ts`

**Interfaces:**
- Produces: `SourceType = 'bankAccount' | 'creditCard'`; `TransactionType` without `'cardCharge'`; `TransactionDto.sourceType: SourceType` + `TransactionDto.sourceId: string` (replacing `accountId?: string`).

- [ ] **Step 1: Edit `shared/src/index.ts`**

Replace:

```ts
export type TransactionType =
  | 'income'
  | 'expense'
  | 'commitmentPayment'
  | 'loanPayment'
  | 'cardPayment'
  | 'cardCharge'
  | 'transfer';
```

with:

```ts
export type TransactionType =
  | 'income'
  | 'expense'
  | 'commitmentPayment'
  | 'loanPayment'
  | 'cardPayment'
  | 'transfer';

export type SourceType = 'bankAccount' | 'creditCard';
```

Replace the `TransactionDto` interface:

```ts
export interface TransactionDto {
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  category?: ExpenseCategory;
  accountId?: string;
  toAccountId?: string;
  linkedEntityId?: string;
  note?: string;
}
```

with:

```ts
export interface TransactionDto {
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  category?: ExpenseCategory;
  sourceType: SourceType;
  sourceId: string;
  toAccountId?: string;
  linkedEntityId?: string;
  note?: string;
}
```

- [ ] **Step 2: Build shared**

Run: `npm run build:shared`
Expected: builds cleanly (no TS errors in `shared/src` itself — downstream errors in `server`/`client` are expected until later tasks and are not checked here).

- [ ] **Step 3: Commit**

```bash
git add shared/src/index.ts
git commit -m "feat(shared): generalize transaction source to bank account or credit card, drop cardCharge"
```

---

### Task 4: Transaction schema — `sourceType`/`sourceId`, drop `cardCharge`

**Files:**
- Modify: `server/src/database/schemas/transaction.schema.ts`

**Interfaces:**
- Consumes: `SourceType`, `TransactionType` from `@finance/shared` (Task 3).
- Produces: `Transaction.sourceType: SourceType` (required), `Transaction.sourceId: Types.ObjectId` (required) — replacing `Transaction.accountId?: Types.ObjectId`.

- [ ] **Step 1: Rewrite the schema**

Replace the full contents of `server/src/database/schemas/transaction.schema.ts`:

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ExpenseCategory, SourceType, TransactionType } from '@finance/shared';

export type TransactionDocument = HydratedDocument<Transaction>;

const TYPES: TransactionType[] = [
  'income',
  'expense',
  'commitmentPayment',
  'loanPayment',
  'cardPayment',
  'transfer',
];

const SOURCE_TYPES: SourceType[] = ['bankAccount', 'creditCard'];

@Schema()
export class Transaction {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: TYPES })
  type: TransactionType;

  @Prop({ required: true })
  amount: number; // integer sen, always positive

  @Prop({ required: true })
  date: Date;

  @Prop()
  category?: ExpenseCategory;

  @Prop({ required: true, enum: SOURCE_TYPES })
  sourceType: SourceType;

  @Prop({ type: Types.ObjectId, required: true })
  sourceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  toAccountId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  linkedEntityId?: Types.ObjectId;

  @Prop({ trim: true })
  note?: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
TransactionSchema.index({ userId: 1, date: -1, _id: -1 });
```

Note: this task alone will not compile/pass tests — `transactions.service.ts`, `bank-accounts.service.ts`, `dashboard.service.ts`, and the e2e specs still reference the old `accountId` field and `cardCharge` type. That's fixed in Tasks 5–7. This task is not run/committed standalone; proceed directly to Task 5 before running any tests.

---

### Task 5: `transactions.service.ts` + DTOs — generalized source, drop `cardCharge`

**Files:**
- Modify: `server/src/transactions/dto.ts`
- Modify: `server/src/transactions/transactions.service.ts`
- Test: `server/test/transactions-create.e2e.spec.ts`
- Test: `server/test/transactions-mutate.e2e.spec.ts`

**Interfaces:**
- Consumes: `Transaction.sourceType`/`sourceId` (Task 4), `SourceType` (Task 3).
- Produces: `CreateTransactionDto.sourceType: SourceType`, `CreateTransactionDto.sourceId: string` (replacing `accountId`); `ListTransactionsQuery.sourceId?: string` (replacing `accountId`).

- [ ] **Step 1: Rewrite `server/src/transactions/dto.ts`**

```ts
import {
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EXPENSE_CATEGORIES,
  ExpenseCategory,
  SourceType,
  TransactionType,
} from '@finance/shared';

const TYPES: TransactionType[] = [
  'income',
  'expense',
  'commitmentPayment',
  'loanPayment',
  'cardPayment',
  'transfer',
];

const SOURCE_TYPES: SourceType[] = ['bankAccount', 'creditCard'];

export class CreateTransactionDto {
  @IsIn(TYPES)
  type: TransactionType;

  @IsInt()
  @Min(1)
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @IsIn(SOURCE_TYPES)
  sourceType: SourceType;

  @IsMongoId()
  sourceId: string;

  @IsOptional()
  @IsMongoId()
  toAccountId?: string;

  @IsOptional()
  @IsMongoId()
  linkedEntityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class UpdateTransactionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class ListTransactionsQuery {
  @IsOptional()
  @IsIn(TYPES)
  type?: TransactionType;

  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @IsOptional()
  @IsMongoId()
  sourceId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
```

- [ ] **Step 2: Rewrite `server/src/transactions/transactions.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Paginated, TransactionDto, TransactionType } from '@finance/shared';
import {
  Transaction,
  TransactionDocument,
} from '../database/schemas/transaction.schema';
import { BankAccount } from '../database/schemas/bank-account.schema';
import { Commitment } from '../database/schemas/commitment.schema';
import { Loan } from '../database/schemas/loan.schema';
import { CreditCard } from '../database/schemas/credit-card.schema';
import { shiftDueDate } from '../common/dates';
import { AuditLogService } from '../audit/audit.service';
import { BankAccountsService } from '../accounts/bank-accounts.service';
import { CommitmentsService } from '../commitments/commitments.service';
import { LoansService } from '../loans/loans.service';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import {
  CreateTransactionDto,
  ListTransactionsQuery,
  UpdateTransactionDto,
} from './dto';

const CARD_SOURCE_ALLOWED = new Set<TransactionType>([
  'expense',
  'commitmentPayment',
  'loanPayment',
]);

@Injectable()
export class TransactionsService {
  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(Transaction.name) private txnModel: Model<Transaction>,
    @InjectModel(BankAccount.name) private bankModel: Model<BankAccount>,
    @InjectModel(Commitment.name) private commitmentModel: Model<Commitment>,
    @InjectModel(Loan.name) private loanModel: Model<Loan>,
    @InjectModel(CreditCard.name) private cardModel: Model<CreditCard>,
    private bankAccounts: BankAccountsService,
    private commitments: CommitmentsService,
    private loans: LoansService,
    private cards: CreditCardsService,
    private audit: AuditLogService,
  ) {}

  toDto(doc: TransactionDocument): TransactionDto {
    return {
      id: doc._id.toHexString(),
      type: doc.type,
      amount: doc.amount,
      date: doc.date.toISOString(),
      category: doc.category,
      sourceType: doc.sourceType,
      sourceId: doc.sourceId.toHexString(),
      toAccountId: doc.toAccountId?.toHexString(),
      linkedEntityId: doc.linkedEntityId?.toHexString(),
      note: doc.note,
    };
  }

  private requireLink(dto: CreateTransactionDto): string {
    if (!dto.linkedEntityId) {
      throw new BadRequestException('linkedEntityId is required for this type.');
    }
    return dto.linkedEntityId;
  }

  private async validateRefs(
    userId: string,
    dto: CreateTransactionDto,
  ): Promise<void> {
    if (dto.sourceType === 'creditCard') {
      if (!CARD_SOURCE_ALLOWED.has(dto.type)) {
        throw new BadRequestException(
          'A credit card cannot be the source for this transaction type.',
        );
      }
      await this.cards.mustOwn(userId, dto.sourceId);
    } else {
      await this.bankAccounts.mustOwn(userId, dto.sourceId);
    }
    if (dto.type === 'expense' && !dto.category) {
      throw new BadRequestException('category is required for expenses.');
    }
    if (dto.type === 'transfer') {
      if (!dto.toAccountId) {
        throw new BadRequestException('toAccountId is required for transfers.');
      }
      if (dto.toAccountId === dto.sourceId) {
        throw new BadRequestException('Cannot transfer to the same account.');
      }
      await this.bankAccounts.mustOwn(userId, dto.toAccountId);
    }
    if (dto.type === 'commitmentPayment') {
      await this.commitments.mustOwn(userId, this.requireLink(dto));
    }
    if (dto.type === 'loanPayment') {
      await this.loans.mustOwn(userId, this.requireLink(dto));
    }
    if (dto.type === 'cardPayment') {
      await this.cards.mustOwn(userId, this.requireLink(dto));
    }
  }

  private async applyEffect(
    txn: TransactionDocument,
    sign: 1 | -1,
    session: ClientSession,
  ): Promise<void> {
    const amt = sign * txn.amount;
    const debitSource = () =>
      txn.sourceType === 'creditCard'
        ? this.cardModel.updateOne(
            { _id: txn.sourceId },
            { $inc: { currentBalance: amt } },
            { session },
          )
        : this.bankModel.updateOne(
            { _id: txn.sourceId },
            { $inc: { currentBalance: -amt } },
            { session },
          );
    switch (txn.type) {
      case 'income':
        await this.bankModel.updateOne(
          { _id: txn.sourceId },
          { $inc: { currentBalance: amt } },
          { session },
        );
        break;
      case 'expense':
        await debitSource();
        break;
      case 'commitmentPayment': {
        await debitSource();
        const c = await this.commitmentModel
          .findById(txn.linkedEntityId)
          .session(session);
        if (c) {
          c.nextDueDate = shiftDueDate(c.nextDueDate, c.dueDayOfMonth, sign);
          await c.save({ session });
        }
        break;
      }
      case 'loanPayment':
        await debitSource();
        await this.loanModel.updateOne(
          { _id: txn.linkedEntityId },
          { $inc: { currentBalance: -amt } },
          { session },
        );
        break;
      case 'cardPayment':
        await debitSource();
        await this.cardModel.updateOne(
          { _id: txn.linkedEntityId },
          { $inc: { currentBalance: -amt, statementBalance: -amt } },
          { session },
        );
        break;
      case 'transfer':
        await debitSource();
        await this.bankModel.updateOne(
          { _id: txn.toAccountId },
          { $inc: { currentBalance: amt } },
          { session },
        );
        break;
    }
  }

  async create(
    userId: string,
    dto: CreateTransactionDto,
  ): Promise<TransactionDto> {
    await this.validateRefs(userId, dto);
    let doc!: TransactionDocument;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        [doc] = await this.txnModel.create(
          [
            {
              userId: new Types.ObjectId(userId),
              type: dto.type,
              amount: dto.amount,
              date: new Date(dto.date),
              category: dto.category,
              sourceType: dto.sourceType,
              sourceId: new Types.ObjectId(dto.sourceId),
              toAccountId: dto.toAccountId
                ? new Types.ObjectId(dto.toAccountId)
                : undefined,
              linkedEntityId: dto.linkedEntityId
                ? new Types.ObjectId(dto.linkedEntityId)
                : undefined,
              note: dto.note,
            },
          ],
          { session },
        );
        await this.applyEffect(doc, 1, session);
      });
    } finally {
      await session.endSession();
    }
    await this.audit.log({
      userId,
      action: 'transaction.created',
      entityType: 'Transaction',
      entityId: doc._id.toHexString(),
      metadata: { type: dto.type, amount: dto.amount },
    });
    return this.toDto(doc);
  }

  async mustOwnTxn(userId: string, id: string): Promise<TransactionDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.txnModel.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateTransactionDto,
  ): Promise<TransactionDto> {
    const doc = await this.mustOwnTxn(userId, id);
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.applyEffect(doc, -1, session);
        if (dto.amount !== undefined) doc.amount = dto.amount;
        if (dto.date !== undefined) doc.date = new Date(dto.date);
        if (dto.category !== undefined) doc.category = dto.category;
        if (dto.note !== undefined) doc.note = dto.note;
        await doc.save({ session });
        await this.applyEffect(doc, 1, session);
      });
    } finally {
      await session.endSession();
    }
    await this.audit.log({
      userId,
      action: 'transaction.updated',
      entityType: 'Transaction',
      entityId: id,
      metadata: { amount: doc.amount },
    });
    return this.toDto(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.mustOwnTxn(userId, id);
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.applyEffect(doc, -1, session);
        await doc.deleteOne({ session });
      });
    } finally {
      await session.endSession();
    }
    await this.audit.log({
      userId,
      action: 'transaction.deleted',
      entityType: 'Transaction',
      entityId: id,
      metadata: { type: doc.type, amount: doc.amount },
    });
  }

  async list(
    userId: string,
    q: ListTransactionsQuery,
  ): Promise<Paginated<TransactionDto>> {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (q.type) filter.type = q.type;
    if (q.category) filter.category = q.category;
    if (q.sourceId) {
      const oid = new Types.ObjectId(q.sourceId);
      filter.$or = [{ sourceId: oid }, { toAccountId: oid }];
    }
    if (q.from || q.to) {
      filter.date = {
        ...(q.from ? { $gte: new Date(q.from) } : {}),
        ...(q.to ? { $lte: new Date(q.to) } : {}),
      };
    }
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10) || 20));
    const [items, total] = await Promise.all([
      this.txnModel
        .find(filter)
        .sort({ date: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      this.txnModel.countDocuments(filter),
    ]);
    return { items: items.map((d) => this.toDto(d)), total };
  }
}
```

- [ ] **Step 3: Rewrite `server/test/transactions-create.e2e.spec.ts`**

```ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

async function getBank(ctx: TestCtx, cookie: string) {
  const res = await request(ctx.app.getHttpServer())
    .get('/api/accounts/bank')
    .set('Cookie', cookie);
  return res.body;
}

describe('transaction creation effects', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let accountId: string;
  let toAccountId: string;
  let commitmentId: string;
  let loanId: string;
  let cardId: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'tx@user.com'));
    const server = ctx.app.getHttpServer();
    accountId = (
      await request(server)
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Main', openingBalance: 500000 })
    ).body.id;
    toAccountId = (
      await request(server)
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Side', openingBalance: 0 })
    ).body.id;
    commitmentId = (
      await request(server)
        .post('/api/commitments')
        .set('Cookie', cookie)
        .send({ name: 'Rent', amount: 150000, dueDayOfMonth: 1 })
    ).body.id;
    loanId = (
      await request(server)
        .post('/api/loans')
        .set('Cookie', cookie)
        .send({ name: 'Car', principal: 5000000, interestRate: 3.5 })
    ).body.id;
    cardId = (
      await request(server)
        .post('/api/credit-cards')
        .set('Cookie', cookie)
        .send({ name: 'Visa', creditLimit: 1000000, statementDay: 5, dueDay: 25 })
    ).body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('income increases the account balance', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'income',
        amount: 300000,
        date: '2026-07-01',
        sourceType: 'bankAccount',
        sourceId: accountId,
      })
      .expect(201);
    const banks = await getBank(ctx, cookie);
    expect(banks.find((b: { id: string }) => b.id === accountId).currentBalance).toBe(
      800000,
    );
  });

  it('expense requires a category and decreases the balance', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 5000,
        date: '2026-07-02',
        sourceType: 'bankAccount',
        sourceId: accountId,
      })
      .expect(400);
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 5000,
        date: '2026-07-02',
        sourceType: 'bankAccount',
        sourceId: accountId,
        category: 'Food',
      })
      .expect(201);
    const banks = await getBank(ctx, cookie);
    expect(banks.find((b: { id: string }) => b.id === accountId).currentBalance).toBe(
      795000,
    );
  });

  it('transfer moves money between accounts', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'transfer',
        amount: 100000,
        date: '2026-07-03',
        sourceType: 'bankAccount',
        sourceId: accountId,
        toAccountId,
      })
      .expect(201);
    const banks = await getBank(ctx, cookie);
    expect(banks.find((b: { id: string }) => b.id === accountId).currentBalance).toBe(
      695000,
    );
    expect(
      banks.find((b: { id: string }) => b.id === toAccountId).currentBalance,
    ).toBe(100000);
  });

  it('commitmentPayment advances the next due date', async () => {
    const before = (
      await request(ctx.app.getHttpServer())
        .get('/api/commitments')
        .set('Cookie', cookie)
    ).body[0].nextDueDate;
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'commitmentPayment',
        amount: 150000,
        date: '2026-07-01',
        sourceType: 'bankAccount',
        sourceId: accountId,
        linkedEntityId: commitmentId,
      })
      .expect(201);
    const after = (
      await request(ctx.app.getHttpServer())
        .get('/api/commitments')
        .set('Cookie', cookie)
    ).body[0].nextDueDate;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('loanPayment reduces bank and loan balances', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'loanPayment',
        amount: 80000,
        date: '2026-07-05',
        sourceType: 'bankAccount',
        sourceId: accountId,
        linkedEntityId: loanId,
      })
      .expect(201);
    const loans = await request(ctx.app.getHttpServer())
      .get('/api/loans')
      .set('Cookie', cookie);
    expect(loans.body[0].currentBalance).toBe(4920000);
  });

  it('a creditCard-sourced expense raises the card balance; cardPayment lowers it and the bank', async () => {
    const server = ctx.app.getHttpServer();
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 20000,
        date: '2026-07-06',
        sourceType: 'creditCard',
        sourceId: cardId,
        category: 'Shopping',
      })
      .expect(201);
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'cardPayment',
        amount: 15000,
        date: '2026-07-07',
        sourceType: 'bankAccount',
        sourceId: accountId,
        linkedEntityId: cardId,
      })
      .expect(201);
    const cards = await request(server)
      .get('/api/credit-cards')
      .set('Cookie', cookie);
    expect(cards.body[0].currentBalance).toBe(5000);
  });

  it('rejects a creditCard source for types that must be paid from a bank account', async () => {
    const server = ctx.app.getHttpServer();
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'income',
        amount: 1000,
        date: '2026-07-10',
        sourceType: 'creditCard',
        sourceId: cardId,
      })
      .expect(400);
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'cardPayment',
        amount: 1000,
        date: '2026-07-10',
        sourceType: 'creditCard',
        sourceId: cardId,
        linkedEntityId: cardId,
      })
      .expect(400);
  });

  it('a commitmentPayment sourced from a credit card charges the card, not the bank', async () => {
    const server = ctx.app.getHttpServer();
    const cardBefore = (
      await request(server).get('/api/credit-cards').set('Cookie', cookie)
    ).body[0].currentBalance;
    const bankBefore = (await getBank(ctx, cookie)).find(
      (b: { id: string }) => b.id === accountId,
    ).currentBalance;
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'commitmentPayment',
        amount: 30000,
        date: '2026-07-11',
        sourceType: 'creditCard',
        sourceId: cardId,
        linkedEntityId: commitmentId,
      })
      .expect(201);
    const cardAfter = (
      await request(server).get('/api/credit-cards').set('Cookie', cookie)
    ).body[0].currentBalance;
    expect(cardAfter).toBe(cardBefore + 30000);
    const bankAfter = (await getBank(ctx, cookie)).find(
      (b: { id: string }) => b.id === accountId,
    ).currentBalance;
    expect(bankAfter).toBe(bankBefore);
  });

  it('rejects transfers to the same account', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'transfer',
        amount: 1,
        date: '2026-07-08',
        sourceType: 'bankAccount',
        sourceId: accountId,
        toAccountId: accountId,
      })
      .expect(400);
  });

  it('404s a transaction against another users account', async () => {
    const other = await seedAuthedUser(ctx.app, 'tx2@user.com');
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', other.cookie)
      .send({
        type: 'income',
        amount: 1,
        date: '2026-07-09',
        sourceType: 'bankAccount',
        sourceId: accountId,
      })
      .expect(404);
  });
});
```

- [ ] **Step 4: Update `server/test/transactions-mutate.e2e.spec.ts`**

Replace every `accountId,` (or `accountId: bank.id,`/similar) key in a request body with `sourceType: 'bankAccount', sourceId: accountId,`. Concretely, replace the file's four request bodies that currently include a bare `accountId,` field:

```ts
        .send({
          type: 'expense',
          amount: 10000,
          date: '2026-07-01',
          accountId,
          category: 'Food',
        })
```

becomes:

```ts
        .send({
          type: 'expense',
          amount: 10000,
          date: '2026-07-01',
          sourceType: 'bankAccount',
          sourceId: accountId,
          category: 'Food',
        })
```

and similarly for the three `.send({ type: 'income', amount: 1000, date: '2026-06-01', accountId })`, `.send({ type: 'expense', amount: 500, date: '2026-07-05', accountId, category: 'Transport' })`, and `.send({ type: 'expense', amount: 700, date: '2026-07-06', accountId, category: 'Food' })` calls in the `'filters by type, category, and date range with pagination'` test — each `accountId` key becomes `sourceType: 'bankAccount', sourceId: accountId`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest server/test/transactions-create.e2e.spec.ts server/test/transactions-mutate.e2e.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/transactions/dto.ts server/src/transactions/transactions.service.ts server/src/database/schemas/transaction.schema.ts server/test/transactions-create.e2e.spec.ts server/test/transactions-mutate.e2e.spec.ts
git commit -m "feat: generalize transaction source to bank account or credit card, remove cardCharge"
```

---

### Task 6: `bank-accounts.service.ts` — follow the `sourceId` rename

**Files:**
- Modify: `server/src/accounts/bank-accounts.service.ts`
- Modify: `server/test/bank-accounts.e2e.spec.ts`
- Modify: `server/test/recompute.e2e.spec.ts`

**Interfaces:**
- Consumes: `Transaction.sourceType`/`sourceId` (Task 4).

`BankAccountsService.remove()` and `.recompute()` still reference the pre-rename `accountId` field name, so with Task 4/5 merged in, deleting an account with transactions, and the drift-recompute endpoint, are both silently broken (queries stop matching anything). Fix them in the same task as their tests so the break is never observable on `main`.

- [ ] **Step 1: Update the failing e2e assertions (they currently pass against the old field name; edit them to use the new request shape first)**

In `server/test/bank-accounts.e2e.spec.ts`, replace the transaction creation inside `'blocks deleting an account with transactions, allows otherwise'`:

```ts
    const txn = await txnModel.create({
      userId,
      type: 'income',
      amount: 1000,
      date: new Date(),
      accountId: new Types.ObjectId(id),
    });
```

becomes:

```ts
    const txn = await txnModel.create({
      userId,
      type: 'income',
      amount: 1000,
      date: new Date(),
      sourceType: 'bankAccount',
      sourceId: new Types.ObjectId(id),
    });
```

In `server/test/recompute.e2e.spec.ts`, replace both request bodies in `beforeAll`:

```ts
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'income', amount: 50000, date: '2026-07-01', accountId });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 20000,
        date: '2026-07-02',
        accountId,
        category: 'Bills',
      });
```

becomes:

```ts
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'income',
        amount: 50000,
        date: '2026-07-01',
        sourceType: 'bankAccount',
        sourceId: accountId,
      });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 20000,
        date: '2026-07-02',
        sourceType: 'bankAccount',
        sourceId: accountId,
        category: 'Bills',
      });
```

- [ ] **Step 2: Run to verify these two specs still fail (service not yet updated)**

Run: `npx jest server/test/bank-accounts.e2e.spec.ts server/test/recompute.e2e.spec.ts --workspace server`
Expected: FAIL — `'blocks deleting an account with transactions...'` expects `409` but gets `200` (the `$or: [{ accountId: ... }]` query in `remove()` no longer matches anything because the field is now called `sourceId`); the recompute tests expect `130000` but the query in `recompute()` also matches nothing so the loop never runs and balance stays at `openingBalance` (`100000`).

- [ ] **Step 3: Fix `server/src/accounts/bank-accounts.service.ts`**

Replace the `remove()` method's `inUse` query:

```ts
    const inUse = await this.txnModel.exists({
      userId: new Types.ObjectId(userId),
      $or: [{ accountId: doc._id }, { toAccountId: doc._id }],
    });
```

with:

```ts
    const inUse = await this.txnModel.exists({
      userId: new Types.ObjectId(userId),
      $or: [{ sourceId: doc._id }, { toAccountId: doc._id }],
    });
```

Replace the `recompute()` method's query and loop:

```ts
    const txns = await this.txnModel.find({
      userId: new Types.ObjectId(userId),
      $or: [{ accountId: acc._id }, { toAccountId: acc._id }],
    });
    let balance = acc.openingBalance;
    for (const t of txns) {
      if (t.toAccountId?.equals(acc._id) && t.type === 'transfer') {
        balance += t.amount;
      }
      if (t.accountId?.equals(acc._id)) {
        balance += t.type === 'income' ? t.amount : -t.amount;
      }
    }
```

with:

```ts
    const txns = await this.txnModel.find({
      userId: new Types.ObjectId(userId),
      $or: [{ sourceId: acc._id }, { toAccountId: acc._id }],
    });
    let balance = acc.openingBalance;
    for (const t of txns) {
      if (t.toAccountId?.equals(acc._id) && t.type === 'transfer') {
        balance += t.amount;
      }
      if (t.sourceId.equals(acc._id)) {
        balance += t.type === 'income' ? t.amount : -t.amount;
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest server/test/bank-accounts.e2e.spec.ts server/test/recompute.e2e.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/accounts/bank-accounts.service.ts server/test/bank-accounts.e2e.spec.ts server/test/recompute.e2e.spec.ts
git commit -m "fix: follow the transaction sourceId rename in bank account delete-guard and recompute"
```

---

### Task 7: `dashboard.service.ts` — drop `cardCharge` from spending trend, follow the rename in dashboard e2e specs

**Files:**
- Modify: `server/src/dashboard/dashboard.service.ts`
- Modify: `server/test/dashboard-summary.e2e.spec.ts`
- Modify: `server/test/dashboard-trends.e2e.spec.ts`

**Interfaces:**
- Consumes: `Transaction.sourceType`/`sourceId` (Task 4), `TransactionType` without `cardCharge` (Task 3).

- [ ] **Step 1: Update `server/test/dashboard-summary.e2e.spec.ts`**

Replace the `cardCharge` transaction in `beforeAll`:

```ts
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'cardCharge',
        amount: 40000,
        date: new Date().toISOString().slice(0, 10),
        linkedEntityId: card.id,
      });
```

with:

```ts
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 40000,
        date: new Date().toISOString().slice(0, 10),
        sourceType: 'creditCard',
        sourceId: card.id,
        category: 'Shopping',
      });
```

Replace the trailing expense's `accountId: bank.id,` with `sourceType: 'bankAccount', sourceId: bank.id,`:

```ts
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
```

becomes:

```ts
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 2500,
        date: new Date().toISOString().slice(0, 10),
        sourceType: 'bankAccount',
        sourceId: bank.id,
        category: 'Food',
      });
```

- [ ] **Step 2: Update `server/test/dashboard-trends.e2e.spec.ts`**

Replace all four `accountId: bank.id` bodies:

```ts
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
```

with:

```ts
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 3000,
        date: today,
        sourceType: 'bankAccount',
        sourceId: bank.id,
        category: 'Food',
      });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 2000,
        date: today,
        sourceType: 'bankAccount',
        sourceId: bank.id,
        category: 'Food',
      });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 7000,
        date: today,
        sourceType: 'bankAccount',
        sourceId: bank.id,
        category: 'Transport',
      });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'income',
        amount: 99999,
        date: today,
        sourceType: 'bankAccount',
        sourceId: bank.id,
      });
```

- [ ] **Step 3: Run to verify current state**

Run: `npx jest server/test/dashboard-summary.e2e.spec.ts server/test/dashboard-trends.e2e.spec.ts --workspace server`
Expected: `dashboard-summary` PASSES already (the `cardCharge`→`expense` swap keeps `cardTotal` at `40000` since `applyEffect`'s `creditCard`-source `expense` branch increments `currentBalance` the same way the old `cardCharge` case did). `dashboard-trends` also PASSES as-is — this step is a checkpoint, not a red/green TDD step, since `dashboard.service.ts` doesn't need to change for these two specs to pass. The one real behavior gap is `spendingTrend`'s `$in` list still containing the now-nonexistent `'cardCharge'` literal, which is dead but harmless (Mongo just never matches it) — fixed for cleanliness in the next step.

- [ ] **Step 4: Remove the dead `cardCharge` literal from `dashboard.service.ts`**

In `server/src/dashboard/dashboard.service.ts`, in `spendingTrend()`, replace:

```ts
          type: { $in: ['expense', 'commitmentPayment', 'cardCharge'] },
```

with:

```ts
          type: { $in: ['expense', 'commitmentPayment'] },
```

- [ ] **Step 5: Run full dashboard suite to confirm no regression**

Run: `npx jest server/test/dashboard-summary.e2e.spec.ts server/test/dashboard-trends.e2e.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/dashboard/dashboard.service.ts server/test/dashboard-summary.e2e.spec.ts server/test/dashboard-trends.e2e.spec.ts
git commit -m "chore: drop dead cardCharge literal from spending trend query, follow transaction source rename in dashboard specs"
```

---

### Task 8: Run the full server suite

**Files:** none (verification-only task)

- [ ] **Step 1: Run every server test**

Run: `npm test --workspace server`
Expected: PASS — this catches any remaining `accountId`/`cardCharge` reference missed in Tasks 4–7 (e.g. TypeScript compile errors would surface here even in files not touched by name-based `grep` above).

- [ ] **Step 2: If anything fails, fix it inline in the relevant file and re-run before proceeding.** Do not commit a broken server suite.

---

### Task 9: Credit card opening balance (client)

**Files:**
- Modify: `client/src/pages/CreditCardsPage.tsx`

**Interfaces:**
- Consumes: `POST /api/credit-cards` already accepts optional `currentBalance?: number` (`CreateCreditCardDto`, unchanged by this plan).

- [ ] **Step 1: Add form state and input**

In `client/src/pages/CreditCardsPage.tsx`, add state after `const [dueDay, setDueDay] = useState('22');`:

```tsx
  const [openingBalance, setOpeningBalance] = useState('');
```

Update `add()` to parse and send it, and reset it on success:

```ts
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
```

Add the input to the form, after the `dueDay` `<Input>` and before the submit `<Button>`:

```tsx
          <Input
            id="openingBalance"
            label="Opening balance (RM, optional)"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
          />
```

- [ ] **Step 2: Manually verify in the browser**

With dev servers running, navigate to Credit Cards, open "Add card," enter a nonzero opening balance, submit, and confirm the card list shows that balance as `currentBalance`. Take a screenshot.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/CreditCardsPage.tsx
git commit -m "feat: expose credit card opening balance in the add-card form"
```

---

### Task 10: Transaction form — credit card as a payment source (client)

**Files:**
- Modify: `client/src/pages/TransactionsPage.tsx`
- Modify: `client/src/pages/DashboardPage.tsx`

**Interfaces:**
- Consumes: `TransactionDto.sourceType`/`sourceId` (Task 3), `POST /api/transactions` now requires `sourceType`/`sourceId` instead of `accountId` (Task 5).

- [ ] **Step 1: Remove the `cardCharge` label from both pages**

In `client/src/pages/DashboardPage.tsx`, remove the `cardCharge: 'Credit card charge',` line from `TYPE_LABELS`.

In `client/src/pages/TransactionsPage.tsx`, remove the same line from its own `TYPE_LABELS` constant:

```ts
const TYPE_LABELS: Record<TransactionType, string> = {
  income: 'Income',
  expense: 'Expense',
  commitmentPayment: 'Commitment payment',
  loanPayment: 'Loan payment',
  cardPayment: 'Credit card payment',
  transfer: 'Transfer',
};
```

- [ ] **Step 2: Add source-type state and a card/bank toggle**

In `client/src/pages/TransactionsPage.tsx`, replace:

```tsx
  const [accountId, setAccountId] = useState('');
```

with:

```tsx
  const [sourceType, setSourceType] = useState<'bankAccount' | 'creditCard'>(
    'bankAccount',
  );
  const [sourceId, setSourceId] = useState('');
```

Replace the derived-flags block:

```ts
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
```

with:

```ts
  const allowsCardSource =
    type === 'expense' || type === 'commitmentPayment' || type === 'loanPayment';
  const needsCategory = type === 'expense';
  const needsToAccount = type === 'transfer';
  const linkedOptions =
    type === 'commitmentPayment'
      ? commitments.map((c) => [c.id, c.name])
      : type === 'loanPayment'
        ? loans.map((l) => [l.id, l.name])
        : type === 'cardPayment'
          ? cards.map((c) => [c.id, c.name])
          : [];
```

- [ ] **Step 3: Reset source type when switching to a type that forces bank-account-only**

Update the type `<Select>`'s `onChange` (in the non-editing branch of the form):

```tsx
              onChange={(e) => {
                setType(e.target.value as TransactionType);
                setLinkedEntityId('');
              }}
```

becomes:

```tsx
              onChange={(e) => {
                const next = e.target.value as TransactionType;
                setType(next);
                setLinkedEntityId('');
                if (
                  next !== 'expense' &&
                  next !== 'commitmentPayment' &&
                  next !== 'loanPayment'
                ) {
                  setSourceType('bankAccount');
                }
                setSourceId('');
              }}
```

- [ ] **Step 4: Replace the account picker with a source-type toggle + scoped picker**

Replace:

```tsx
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
```

with:

```tsx
              {allowsCardSource && (
                <Select
                  id="sourceType"
                  label="Pay from"
                  value={sourceType}
                  onChange={(e) => {
                    setSourceType(e.target.value as 'bankAccount' | 'creditCard');
                    setSourceId('');
                  }}
                >
                  <option value="bankAccount">Bank account</option>
                  <option value="creditCard">Credit card</option>
                </Select>
              )}
              <Select
                id="source"
                label={sourceType === 'creditCard' ? 'Credit card' : 'Account'}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                required
              >
                <option value="">Select {sourceType === 'creditCard' ? 'card' : 'account'}…</option>
                {(sourceType === 'creditCard' ? cards : banks).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
```

- [ ] **Step 5: Scope the "to account" picker to `sourceId` instead of `accountId`, and update the submit payload**

Replace:

```tsx
                  {banks
                    .filter((b) => b.id !== accountId)
                    .map((b) => (
```

with:

```tsx
                  {banks
                    .filter((b) => b.id !== sourceId)
                    .map((b) => (
```

Replace the `submit()` POST body:

```ts
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
```

with:

```ts
          body: {
            type,
            amount: sen,
            date,
            ...(needsCategory ? { category } : {}),
            sourceType,
            sourceId,
            ...(needsToAccount ? { toAccountId } : {}),
            ...(linkedOptions.length ? { linkedEntityId } : {}),
            ...(note ? { note } : {}),
          },
```

- [ ] **Step 6: Reset source fields in `openAdd()`**

Replace:

```ts
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
```

with:

```ts
  function openAdd() {
    setEditing(null);
    setType('expense');
    setAmount('');
    setDate(new Date().toISOString().slice(0, 10));
    setCategory(EXPENSE_CATEGORIES[0]);
    setSourceType('bankAccount');
    setSourceId('');
    setToAccountId('');
    setLinkedEntityId('');
    setNote('');
    setDrawerOpen(true);
  }
```

- [ ] **Step 7: Manually verify in the browser**

With dev servers running: (a) add an expense with source "Credit card," confirm the card's balance rises and no bank account changes; (b) add a commitment payment sourced from a credit card, confirm the commitment's due date advances and the card balance rises; (c) add an income transaction, confirm no "Pay from" toggle is shown and only a bank account picker appears; (d) filter the transaction list by type and confirm "Credit card charge" no longer appears as a filter option. Take a screenshot of the add-transaction drawer with the credit card source selected.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/TransactionsPage.tsx client/src/pages/DashboardPage.tsx
git commit -m "feat: let expenses, commitment payments, and loan payments be sourced from a credit card"
```

---

## Self-Review Notes

- **Spec coverage:** Thread A (Task 1–2), Thread B schema/service generalization (Task 3–8), credit card opening balance (Task 9), client source picker (Task 10) — all four original requests and both design-doc threads are covered.
- **Placeholder scan:** no TBD/TODO; every step shows real code.
- **Type consistency:** `SourceType` name and `'bankAccount' | 'creditCard'` values are identical across Tasks 3–10; `sourceType`/`sourceId` field names match across schema (Task 4), DTO (Task 5), service (Task 5), and client (Task 10).
- **Ordering note:** Task 4 (schema) intentionally leaves the codebase non-compiling until Task 5 lands — both are meant to be executed back-to-back before running tests, as called out in Task 4's final step.
