# Plan 2 of 3: Financial Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All financial entities (bank accounts, savings/investment accounts + value snapshots, commitments, loans, credit cards) with CRUD APIs, transactions that atomically update linked balances, a balance-recompute repair action, financial audit events, and the corresponding frontend pages.

**Architecture:** Builds directly on Plan 1's NestJS modules, AuthGuard, and AuditLogService. Each entity gets a Nest module with ownership-scoped CRUD (every query filters by `userId`). `TransactionsService` applies balance effects through a single `applyEffect(txn, sign, session)` function inside a MongoDB multi-document transaction — creates apply `+1`, deletes apply `-1`, updates apply `-1` then `+1`. Multi-document transactions require a replica set, so Mongo (both docker-compose and the test memory server) switches to single-node replica-set mode.

**Tech Stack:** Same as Plan 1. New: `MongoMemoryReplSet` from mongodb-memory-server.

**Spec:** `docs/superpowers/specs/2026-07-12-finance-tracker-design.md`. Prerequisite: Plan 1 fully implemented (`docs/superpowers/plans/2026-07-12-plan-1-foundation-auth.md`).

## Global Constraints

- All Plan 1 global constraints still apply.
- **Money is stored and transmitted as integer sen** (RM 12.34 = `1234`). No floats anywhere in schemas or DTOs; the client converts at the display/input boundary only.
- Every entity query filters by the session's `userId`; cross-user access returns 404 (never 403 — do not confirm existence).
- Entities referenced by any transaction cannot be deleted (409); delete the transactions first.
- Transaction balance effects run inside `session.withTransaction(...)`; MongoDB must be a replica set (`?replicaSet=rs0` in the URI).
- Transaction `type` and entity links (`accountId`, `toAccountId`, `linkedEntityId`) are immutable after creation; only `amount`, `date`, `category`, `note` are editable.
- Recurrence is monthly-only in v1: a commitment has `dueDayOfMonth` (1-31, clamped to month length).
- Audit actions added in this plan: `bankAccount.created|updated|deleted|recomputed`, `savingsAccount.created|updated|deleted`, `snapshot.added`, `commitment.created|updated|deleted`, `loan.created|updated|deleted`, `creditCard.created|updated|deleted`, `transaction.created|updated|deleted`.
- All new endpoints require a full-scope session (`AuthGuard`, no `@AllowPendingSession`).

---

### Task 1: Switch MongoDB to single-node replica set (tests + compose)

**Files:**
- Modify: `server/test/utils/mongo.ts`, `docker-compose.yml`, `.env.example`, `README.md`

**Interfaces:**
- Consumes: Plan 1's `startMemoryMongo` helper (same signature, new engine).
- Produces: `startMemoryMongo()` now backed by `MongoMemoryReplSet`; dev Mongo runs `--replSet rs0`; `MONGODB_URI` gains `?replicaSet=rs0&directConnection=true`.

- [ ] **Step 1: Update the test helper**

`server/test/utils/mongo.ts` (full replacement):
```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export async function startMemoryMongo(): Promise<{
  uri: string;
  stop: () => Promise<void>;
}> {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return {
    uri: mongod.getUri('finance-test'),
    stop: async () => {
      await mongod.stop();
    },
  };
}
```

- [ ] **Step 2: Run the full server suite**

Run: `npm test --workspace server`
Expected: all Plan 1 tests still PASS (replica-set startup is a bit slower on first run).

- [ ] **Step 3: Update docker-compose and env**

`docker-compose.yml` (replace the mongo service):
```yaml
services:
  mongo:
    image: mongo:8
    restart: unless-stopped
    command: ["--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: ["CMD-SHELL", "mongosh --quiet --eval 'try { rs.status().ok } catch (e) { rs.initiate().ok }'"]
      interval: 5s
      timeout: 30s
      retries: 30

volumes:
  mongo-data:
```

`.env.example` — change the URI line to:
```
MONGODB_URI=mongodb://localhost:27017/finance-tracker?replicaSet=rs0&directConnection=true
```

Update the matching line in your local `.env`, and add one line to README's Development section: "Mongo runs as a single-node replica set (required for multi-document transactions); the compose healthcheck initiates it automatically."

- [ ] **Step 4: Verify compose**

Run: `docker compose down && docker compose up -d mongo`, wait ~15s, then `docker compose ps`
Expected: mongo `running (healthy)`.
Run: `npm run start:dev --workspace server` briefly — Nest connects without error.

- [ ] **Step 5: Commit**

```bash
git add server/test/utils/mongo.ts docker-compose.yml .env.example README.md
git commit -m "chore: run MongoDB as single-node replica set for multi-document transactions"
```

---

### Task 2: Shared financial types and money convention

**Files:**
- Modify: `shared/src/index.ts` (append)

**Interfaces:**
- Produces (all money fields are integer sen; all dates ISO strings):
  - `BankAccountDto { id, name, openingBalance, currentBalance, createdAt }`
  - `SavingsAccountDto { id, name, type: 'savings' | 'investment', latestValue: number | null, latestValueDate: string | null, createdAt }`
  - `ValueSnapshotDto { id, date, value }`
  - `CommitmentStatus = 'overdue' | 'dueSoon' | 'upcoming'`
  - `CommitmentDto { id, name, amount, dueDayOfMonth, nextDueDate, active, status }`
  - `LoanDto { id, name, principal, interestRate, currentBalance, startDate }`
  - `CreditCardDto { id, name, creditLimit, statementBalance, currentBalance, statementDay, dueDay }`
  - `TransactionDto { id, type, amount, date, category?, accountId?, toAccountId?, linkedEntityId?, note? }`
  - `Paginated<T> { items: T[]; total: number }`

- [ ] **Step 1: Append the types**

Append to `shared/src/index.ts`:
```ts
// ---- Financial DTOs (Plan 2) ----
// All money values are integer sen (RM 12.34 === 1234). All dates are ISO strings.

export interface BankAccountDto {
  id: string;
  name: string;
  openingBalance: number;
  currentBalance: number;
  createdAt: string;
}

export interface SavingsAccountDto {
  id: string;
  name: string;
  type: 'savings' | 'investment';
  latestValue: number | null;
  latestValueDate: string | null;
  createdAt: string;
}

export interface ValueSnapshotDto {
  id: string;
  date: string;
  value: number;
}

export type CommitmentStatus = 'overdue' | 'dueSoon' | 'upcoming';

export interface CommitmentDto {
  id: string;
  name: string;
  amount: number;
  dueDayOfMonth: number;
  nextDueDate: string;
  active: boolean;
  status: CommitmentStatus;
}

export interface LoanDto {
  id: string;
  name: string;
  principal: number;
  interestRate: number;
  currentBalance: number;
  startDate: string;
}

export interface CreditCardDto {
  id: string;
  name: string;
  creditLimit: number;
  statementBalance: number;
  currentBalance: number;
  statementDay: number;
  dueDay: number;
}

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

export interface Paginated<T> {
  items: T[];
  total: number;
}
```

- [ ] **Step 2: Build and commit**

Run: `npm run build:shared`
Expected: clean build.

```bash
git add shared/src/index.ts
git commit -m "feat(shared): add financial DTO types with integer-sen money convention"
```

---

### Task 3: Financial Mongoose schemas + date helpers

**Files:**
- Create: `server/src/database/schemas/bank-account.schema.ts`, `savings-account.schema.ts`, `value-snapshot.schema.ts`, `commitment.schema.ts`, `loan.schema.ts`, `credit-card.schema.ts`, `transaction.schema.ts` (all under `server/src/database/schemas/`)
- Create: `server/src/common/dates.ts`
- Modify: `server/src/database/database.module.ts` (register the new models)
- Test: `server/src/common/dates.spec.ts`

**Interfaces:**
- Produces: models registered in the global DatabaseModule, plus pure date helpers:
  - `dueDateInMonth(year: number, monthIdx: number, dueDay: number): Date` — UTC date, day clamped to month length.
  - `nextDueDateFrom(dueDay: number, from?: Date): Date` — this month's occurrence if today or later, else next month's.
  - `shiftDueDate(current: Date, dueDay: number, deltaMonths: number): Date`.
  - `commitmentStatus(nextDueDate: Date, today?: Date): 'overdue' | 'dueSoon' | 'upcoming'` (dueSoon = within 14 days).

- [ ] **Step 1: Write the failing date-helper test**

`server/src/common/dates.spec.ts`:
```ts
import {
  commitmentStatus,
  dueDateInMonth,
  nextDueDateFrom,
  shiftDueDate,
} from './dates';

describe('date helpers', () => {
  it('clamps the due day to the month length', () => {
    expect(dueDateInMonth(2026, 1, 31).toISOString().slice(0, 10)).toBe(
      '2026-02-28',
    );
    expect(dueDateInMonth(2026, 0, 31).toISOString().slice(0, 10)).toBe(
      '2026-01-31',
    );
  });

  it('nextDueDateFrom picks this month when still ahead, else next month', () => {
    const from = new Date(Date.UTC(2026, 6, 10)); // 2026-07-10
    expect(nextDueDateFrom(15, from).toISOString().slice(0, 10)).toBe(
      '2026-07-15',
    );
    expect(nextDueDateFrom(5, from).toISOString().slice(0, 10)).toBe(
      '2026-08-05',
    );
    expect(nextDueDateFrom(10, from).toISOString().slice(0, 10)).toBe(
      '2026-07-10',
    );
  });

  it('shiftDueDate moves by months and re-clamps to the due day', () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31));
    expect(shiftDueDate(jan31, 31, 1).toISOString().slice(0, 10)).toBe(
      '2026-02-28',
    );
    const feb28 = new Date(Date.UTC(2026, 1, 28));
    expect(shiftDueDate(feb28, 31, 1).toISOString().slice(0, 10)).toBe(
      '2026-03-31',
    );
    expect(shiftDueDate(feb28, 31, -1).toISOString().slice(0, 10)).toBe(
      '2026-01-31',
    );
  });

  it('commitmentStatus buckets by proximity', () => {
    const today = new Date(Date.UTC(2026, 6, 10));
    expect(commitmentStatus(new Date(Date.UTC(2026, 6, 9)), today)).toBe(
      'overdue',
    );
    expect(commitmentStatus(new Date(Date.UTC(2026, 6, 20)), today)).toBe(
      'dueSoon',
    );
    expect(commitmentStatus(new Date(Date.UTC(2026, 7, 20)), today)).toBe(
      'upcoming',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- dates`
Expected: FAIL — cannot find module `./dates`.

- [ ] **Step 3: Implement the date helpers**

`server/src/common/dates.ts`:
```ts
export function dueDateInMonth(
  year: number,
  monthIdx: number,
  dueDay: number,
): Date {
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIdx, Math.min(dueDay, lastDay)));
}

function stripTime(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function nextDueDateFrom(dueDay: number, from = new Date()): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const thisMonth = dueDateInMonth(y, m, dueDay);
  return thisMonth >= stripTime(from)
    ? thisMonth
    : dueDateInMonth(y, m + 1, dueDay);
}

export function shiftDueDate(
  current: Date,
  dueDay: number,
  deltaMonths: number,
): Date {
  return dueDateInMonth(
    current.getUTCFullYear(),
    current.getUTCMonth() + deltaMonths,
    dueDay,
  );
}

const DUE_SOON_DAYS = 14;

export function commitmentStatus(
  nextDueDate: Date,
  today = new Date(),
): 'overdue' | 'dueSoon' | 'upcoming' {
  const t = stripTime(today).getTime();
  const due = stripTime(nextDueDate).getTime();
  if (due < t) return 'overdue';
  if (due - t <= DUE_SOON_DAYS * 24 * 60 * 60 * 1000) return 'dueSoon';
  return 'upcoming';
}
```

- [ ] **Step 4: Write the schemas**

`server/src/database/schemas/bank-account.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BankAccountDocument = HydratedDocument<BankAccount>;

@Schema()
export class BankAccount {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  openingBalance: number; // integer sen

  @Prop({ required: true })
  currentBalance: number; // integer sen, maintained atomically by transactions

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);
```

`server/src/database/schemas/savings-account.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SavingsAccountDocument = HydratedDocument<SavingsAccount>;

@Schema()
export class SavingsAccount {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, enum: ['savings', 'investment'] })
  type: 'savings' | 'investment';

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const SavingsAccountSchema =
  SchemaFactory.createForClass(SavingsAccount);
```

`server/src/database/schemas/value-snapshot.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ValueSnapshotDocument = HydratedDocument<ValueSnapshot>;

@Schema()
export class ValueSnapshot {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  accountId: Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  value: number; // integer sen
}

export const ValueSnapshotSchema = SchemaFactory.createForClass(ValueSnapshot);
ValueSnapshotSchema.index({ accountId: 1, date: -1 });
```

`server/src/database/schemas/commitment.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CommitmentDocument = HydratedDocument<Commitment>;

@Schema()
export class Commitment {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  amount: number; // integer sen

  @Prop({ required: true, min: 1, max: 31 })
  dueDayOfMonth: number;

  @Prop({ required: true })
  nextDueDate: Date;

  @Prop({ default: true })
  active: boolean;
}

export const CommitmentSchema = SchemaFactory.createForClass(Commitment);
```

`server/src/database/schemas/loan.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LoanDocument = HydratedDocument<Loan>;

@Schema()
export class Loan {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  principal: number; // integer sen

  @Prop({ required: true })
  interestRate: number; // annual %, reference only in v1

  @Prop({ required: true })
  currentBalance: number; // integer sen

  @Prop({ default: () => new Date() })
  startDate: Date;
}

export const LoanSchema = SchemaFactory.createForClass(Loan);
```

`server/src/database/schemas/credit-card.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CreditCardDocument = HydratedDocument<CreditCard>;

@Schema()
export class CreditCard {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  creditLimit: number; // integer sen

  @Prop({ default: 0 })
  statementBalance: number; // integer sen

  @Prop({ default: 0 })
  currentBalance: number; // integer sen

  @Prop({ required: true, min: 1, max: 28 })
  statementDay: number;

  @Prop({ required: true, min: 1, max: 28 })
  dueDay: number;

  @Prop({ default: () => new Date() })
  lastStatementAt: Date;
}

export const CreditCardSchema = SchemaFactory.createForClass(CreditCard);
```

`server/src/database/schemas/transaction.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ExpenseCategory, TransactionType } from '@finance/shared';

export type TransactionDocument = HydratedDocument<Transaction>;

const TYPES: TransactionType[] = [
  'income',
  'expense',
  'commitmentPayment',
  'loanPayment',
  'cardPayment',
  'cardCharge',
  'transfer',
];

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

  @Prop({ type: Types.ObjectId })
  accountId?: Types.ObjectId;

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

- [ ] **Step 5: Register the models**

In `server/src/database/database.module.ts`, extend the `forFeature` array with:
```ts
  { name: BankAccount.name, schema: BankAccountSchema },
  { name: SavingsAccount.name, schema: SavingsAccountSchema },
  { name: ValueSnapshot.name, schema: ValueSnapshotSchema },
  { name: Commitment.name, schema: CommitmentSchema },
  { name: Loan.name, schema: LoanSchema },
  { name: CreditCard.name, schema: CreditCardSchema },
  { name: Transaction.name, schema: TransactionSchema },
```
(with the corresponding imports at the top of the file).

- [ ] **Step 6: Run tests and commit**

Run: `npm test --workspace server`
Expected: all PASS including the new `dates` tests.

```bash
git add server/src/database/ server/src/common/
git commit -m "feat(server): add financial schemas and due-date helpers"
```

---

### Task 4: Bank accounts module

**Files:**
- Create: `server/src/accounts/accounts.module.ts`, `server/src/accounts/bank-accounts.service.ts`, `server/src/accounts/bank-accounts.controller.ts`, `server/src/accounts/dto.ts`
- Modify: `server/src/app.module.ts` (import AccountsModule)
- Test: `server/test/utils/auth.ts`, `server/test/bank-accounts.e2e.spec.ts`

**Interfaces:**
- Consumes: `BankAccount` + `Transaction` models, `AuthGuard`, `AuditLogService`.
- Produces:
  - `GET /api/accounts/bank` → `BankAccountDto[]`.
  - `POST /api/accounts/bank` body `{ name, openingBalance }` → `BankAccountDto` (currentBalance initialized to openingBalance).
  - `PATCH /api/accounts/bank/:id` body `{ name? }` → `BankAccountDto`.
  - `DELETE /api/accounts/bank/:id` → `{ ok: true }`; 409 if any transaction references it.
  - `BankAccountsService.toDto(doc): BankAccountDto` and `BankAccountsService.mustOwn(userId, id): Promise<BankAccountDocument>` (404 when missing/not owned) — reused by TransactionsService.
  - Test helper `seedAuthedUser(app, email?): Promise<{ userId: Types.ObjectId; cookie: string }>` — inserts a verified user and a full-scope session directly, no WebAuthn mock needed.

- [ ] **Step 1: Write the auth seeding helper and failing e2e test**

`server/test/utils/auth.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { User } from '../../src/database/schemas/user.schema';
import { Session } from '../../src/database/schemas/session.schema';

export async function seedAuthedUser(
  app: INestApplication,
  email = 'fin@user.com',
): Promise<{ userId: Types.ObjectId; cookie: string }> {
  const userModel: Model<User> = app.get(getModelToken(User.name));
  const sessionModel: Model<Session> = app.get(getModelToken(Session.name));
  const user = await userModel.create({ email, emailVerified: true });
  const token = randomBytes(16).toString('base64url');
  await sessionModel.create({
    tokenHash: createHash('sha256').update(token).digest('hex'),
    userId: user._id,
    scope: 'full',
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { userId: user._id, cookie: `sid=${token}` };
}
```

`server/test/bank-accounts.e2e.spec.ts`:
```ts
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';
import { Transaction } from '../src/database/schemas/transaction.schema';

describe('bank accounts', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let userId: Types.ObjectId;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie, userId } = await seedAuthedUser(ctx.app));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('creates an account with currentBalance = openingBalance', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/accounts/bank')
      .set('Cookie', cookie)
      .send({ name: 'Maybank', openingBalance: 150000 })
      .expect(201);
    expect(res.body.currentBalance).toBe(150000);
    expect(res.body.name).toBe('Maybank');
  });

  it('lists only the owners accounts', async () => {
    const other = await seedAuthedUser(ctx.app, 'other@user.com');
    await request(ctx.app.getHttpServer())
      .post('/api/accounts/bank')
      .set('Cookie', other.cookie)
      .send({ name: 'Other Bank', openingBalance: 0 });
    const res = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Maybank');
  });

  it('renames an account', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    const id = list.body[0].id;
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/accounts/bank/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Maybank Savings' })
      .expect(200);
    expect(res.body.name).toBe('Maybank Savings');
  });

  it('404s updates to another users account', async () => {
    const other = await seedAuthedUser(ctx.app, 'third@user.com');
    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    await request(ctx.app.getHttpServer())
      .patch(`/api/accounts/bank/${list.body[0].id}`)
      .set('Cookie', other.cookie)
      .send({ name: 'hijack' })
      .expect(404);
  });

  it('blocks deleting an account with transactions, allows otherwise', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    const id = list.body[0].id;
    const txnModel: Model<Transaction> = ctx.app.get(
      getModelToken(Transaction.name),
    );
    const txn = await txnModel.create({
      userId,
      type: 'income',
      amount: 1000,
      date: new Date(),
      accountId: new Types.ObjectId(id),
    });
    await request(ctx.app.getHttpServer())
      .delete(`/api/accounts/bank/${id}`)
      .set('Cookie', cookie)
      .expect(409);
    await txn.deleteOne();
    await request(ctx.app.getHttpServer())
      .delete(`/api/accounts/bank/${id}`)
      .set('Cookie', cookie)
      .expect(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- bank-accounts`
Expected: FAIL — 404 on `/api/accounts/bank`.

- [ ] **Step 3: Implement DTOs, service, controller, module**

`server/src/accounts/dto.ts`:
```ts
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsInt()
  @Min(0)
  openingBalance: number;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class CreateSavingsAccountDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsIn(['savings', 'investment'])
  type: 'savings' | 'investment';
}

export class UpdateSavingsAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class CreateSnapshotDto {
  @IsDateString()
  date: string;

  @IsInt()
  @Min(0)
  value: number;
}
```

`server/src/accounts/bank-accounts.service.ts`:
```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BankAccountDto } from '@finance/shared';
import {
  BankAccount,
  BankAccountDocument,
} from '../database/schemas/bank-account.schema';
import { Transaction } from '../database/schemas/transaction.schema';
import { AuditLogService } from '../audit/audit.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto';

@Injectable()
export class BankAccountsService {
  constructor(
    @InjectModel(BankAccount.name) private model: Model<BankAccount>,
    @InjectModel(Transaction.name) private txnModel: Model<Transaction>,
    private audit: AuditLogService,
  ) {}

  toDto(doc: BankAccountDocument): BankAccountDto {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      openingBalance: doc.openingBalance,
      currentBalance: doc.currentBalance,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async mustOwn(userId: string, id: string): Promise<BankAccountDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async list(userId: string): Promise<BankAccountDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 });
    return docs.map((d) => this.toDto(d));
  }

  async create(
    userId: string,
    dto: CreateBankAccountDto,
  ): Promise<BankAccountDto> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      openingBalance: dto.openingBalance,
      currentBalance: dto.openingBalance,
    });
    await this.audit.log({
      userId,
      action: 'bankAccount.created',
      entityType: 'BankAccount',
      entityId: doc._id.toHexString(),
      metadata: { name: dto.name, openingBalance: dto.openingBalance },
    });
    return this.toDto(doc);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateBankAccountDto,
  ): Promise<BankAccountDto> {
    const doc = await this.mustOwn(userId, id);
    if (dto.name !== undefined) doc.name = dto.name;
    await doc.save();
    await this.audit.log({
      userId,
      action: 'bankAccount.updated',
      entityType: 'BankAccount',
      entityId: id,
      metadata: { name: doc.name },
    });
    return this.toDto(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.mustOwn(userId, id);
    const inUse = await this.txnModel.exists({
      userId: new Types.ObjectId(userId),
      $or: [{ accountId: doc._id }, { toAccountId: doc._id }],
    });
    if (inUse) {
      throw new ConflictException(
        'Account has transactions. Delete them first.',
      );
    }
    await doc.deleteOne();
    await this.audit.log({
      userId,
      action: 'bankAccount.deleted',
      entityType: 'BankAccount',
      entityId: id,
      metadata: { name: doc.name },
    });
  }
}
```

`server/src/accounts/bank-accounts.controller.ts`:
```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/session.service';
import { BankAccountsService } from './bank-accounts.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto';

@Controller('accounts/bank')
@UseGuards(AuthGuard)
export class BankAccountsController {
  constructor(private service: BankAccountsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBankAccountDto) {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.remove(user.userId, id);
    return { ok: true };
  }
}
```

`server/src/accounts/accounts.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { BankAccountsService } from './bank-accounts.service';
import { BankAccountsController } from './bank-accounts.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [BankAccountsController],
  providers: [BankAccountsService],
  exports: [BankAccountsService],
})
export class AccountsModule {}
```

Add `AccountsModule` to `server/src/app.module.ts` imports.

- [ ] **Step 4: Run tests and commit**

Run: `npm test --workspace server -- bank-accounts`
Expected: PASS (5 tests).

```bash
git add server/src/accounts/ server/src/app.module.ts server/test/
git commit -m "feat(server): add bank accounts CRUD with ownership checks and audit"
```

---

### Task 5: Savings/investment accounts + value snapshots

**Files:**
- Create: `server/src/accounts/savings-accounts.service.ts`, `server/src/accounts/savings-accounts.controller.ts`
- Modify: `server/src/accounts/accounts.module.ts` (register them)
- Test: `server/test/savings-accounts.e2e.spec.ts`

**Interfaces:**
- Consumes: `SavingsAccount` + `ValueSnapshot` models, `AuthGuard`, `AuditLogService`, DTOs from Task 4's `dto.ts`.
- Produces:
  - `GET /api/accounts/savings` → `SavingsAccountDto[]` (each with `latestValue`/`latestValueDate` from its newest snapshot, or nulls).
  - `POST /api/accounts/savings` body `{ name, type }` → `SavingsAccountDto`.
  - `PATCH /api/accounts/savings/:id` body `{ name? }` → `SavingsAccountDto`.
  - `DELETE /api/accounts/savings/:id` → `{ ok: true }`; also deletes its snapshots (snapshots are not transactions — no 409 rule here).
  - `GET /api/accounts/savings/:id/snapshots` → `ValueSnapshotDto[]` (date desc).
  - `POST /api/accounts/savings/:id/snapshots` body `{ date, value }` → `ValueSnapshotDto`; audits `snapshot.added`.

- [ ] **Step 1: Write the failing e2e test**

`server/test/savings-accounts.e2e.spec.ts`:
```ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('savings/investment accounts', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let accountId: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'sav@user.com'));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('creates an investment account with null latest value', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/accounts/savings')
      .set('Cookie', cookie)
      .send({ name: 'ASB', type: 'investment' })
      .expect(201);
    accountId = res.body.id;
    expect(res.body.latestValue).toBeNull();
  });

  it('logs snapshots and surfaces the latest on the list', async () => {
    await request(ctx.app.getHttpServer())
      .post(`/api/accounts/savings/${accountId}/snapshots`)
      .set('Cookie', cookie)
      .send({ date: '2026-06-30', value: 1000000 })
      .expect(201);
    await request(ctx.app.getHttpServer())
      .post(`/api/accounts/savings/${accountId}/snapshots`)
      .set('Cookie', cookie)
      .send({ date: '2026-07-31', value: 1050000 })
      .expect(201);

    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/savings')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body[0].latestValue).toBe(1050000);
    expect(list.body[0].latestValueDate).toContain('2026-07-31');

    const snaps = await request(ctx.app.getHttpServer())
      .get(`/api/accounts/savings/${accountId}/snapshots`)
      .set('Cookie', cookie)
      .expect(200);
    expect(snaps.body).toHaveLength(2);
    expect(snaps.body[0].value).toBe(1050000);
  });

  it('404s snapshots on another users account', async () => {
    const other = await seedAuthedUser(ctx.app, 'sav2@user.com');
    await request(ctx.app.getHttpServer())
      .post(`/api/accounts/savings/${accountId}/snapshots`)
      .set('Cookie', other.cookie)
      .send({ date: '2026-07-01', value: 1 })
      .expect(404);
  });

  it('deletes the account together with its snapshots', async () => {
    await request(ctx.app.getHttpServer())
      .delete(`/api/accounts/savings/${accountId}`)
      .set('Cookie', cookie)
      .expect(200);
    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/savings')
      .set('Cookie', cookie);
    expect(list.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- savings`
Expected: FAIL — 404 on `/api/accounts/savings`.

- [ ] **Step 3: Implement service and controller**

`server/src/accounts/savings-accounts.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SavingsAccountDto, ValueSnapshotDto } from '@finance/shared';
import {
  SavingsAccount,
  SavingsAccountDocument,
} from '../database/schemas/savings-account.schema';
import { ValueSnapshot } from '../database/schemas/value-snapshot.schema';
import { AuditLogService } from '../audit/audit.service';
import {
  CreateSavingsAccountDto,
  CreateSnapshotDto,
  UpdateSavingsAccountDto,
} from './dto';

@Injectable()
export class SavingsAccountsService {
  constructor(
    @InjectModel(SavingsAccount.name) private model: Model<SavingsAccount>,
    @InjectModel(ValueSnapshot.name)
    private snapshotModel: Model<ValueSnapshot>,
    private audit: AuditLogService,
  ) {}

  private async mustOwn(
    userId: string,
    id: string,
  ): Promise<SavingsAccountDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  private async toDto(doc: SavingsAccountDocument): Promise<SavingsAccountDto> {
    const latest = await this.snapshotModel
      .findOne({ accountId: doc._id })
      .sort({ date: -1 });
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      type: doc.type,
      latestValue: latest?.value ?? null,
      latestValueDate: latest?.date.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async list(userId: string): Promise<SavingsAccountDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 });
    return Promise.all(docs.map((d) => this.toDto(d)));
  }

  async create(
    userId: string,
    dto: CreateSavingsAccountDto,
  ): Promise<SavingsAccountDto> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      type: dto.type,
    });
    await this.audit.log({
      userId,
      action: 'savingsAccount.created',
      entityType: 'SavingsAccount',
      entityId: doc._id.toHexString(),
      metadata: { name: dto.name, type: dto.type },
    });
    return this.toDto(doc);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateSavingsAccountDto,
  ): Promise<SavingsAccountDto> {
    const doc = await this.mustOwn(userId, id);
    if (dto.name !== undefined) doc.name = dto.name;
    await doc.save();
    await this.audit.log({
      userId,
      action: 'savingsAccount.updated',
      entityType: 'SavingsAccount',
      entityId: id,
      metadata: { name: doc.name },
    });
    return this.toDto(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.mustOwn(userId, id);
    await this.snapshotModel.deleteMany({ accountId: doc._id });
    await doc.deleteOne();
    await this.audit.log({
      userId,
      action: 'savingsAccount.deleted',
      entityType: 'SavingsAccount',
      entityId: id,
      metadata: { name: doc.name },
    });
  }

  async listSnapshots(userId: string, id: string): Promise<ValueSnapshotDto[]> {
    const doc = await this.mustOwn(userId, id);
    const snaps = await this.snapshotModel
      .find({ accountId: doc._id })
      .sort({ date: -1 });
    return snaps.map((s) => ({
      id: s._id.toHexString(),
      date: s.date.toISOString(),
      value: s.value,
    }));
  }

  async addSnapshot(
    userId: string,
    id: string,
    dto: CreateSnapshotDto,
  ): Promise<ValueSnapshotDto> {
    const doc = await this.mustOwn(userId, id);
    const snap = await this.snapshotModel.create({
      accountId: doc._id,
      date: new Date(dto.date),
      value: dto.value,
    });
    await this.audit.log({
      userId,
      action: 'snapshot.added',
      entityType: 'SavingsAccount',
      entityId: id,
      metadata: { date: dto.date, value: dto.value },
    });
    return {
      id: snap._id.toHexString(),
      date: snap.date.toISOString(),
      value: snap.value,
    };
  }
}
```

`server/src/accounts/savings-accounts.controller.ts`:
```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/session.service';
import { SavingsAccountsService } from './savings-accounts.service';
import {
  CreateSavingsAccountDto,
  CreateSnapshotDto,
  UpdateSavingsAccountDto,
} from './dto';

@Controller('accounts/savings')
@UseGuards(AuthGuard)
export class SavingsAccountsController {
  constructor(private service: SavingsAccountsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.userId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSavingsAccountDto,
  ) {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateSavingsAccountDto,
  ) {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.remove(user.userId, id);
    return { ok: true };
  }

  @Get(':id/snapshots')
  listSnapshots(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listSnapshots(user.userId, id);
  }

  @Post(':id/snapshots')
  addSnapshot(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateSnapshotDto,
  ) {
    return this.service.addSnapshot(user.userId, id, dto);
  }
}
```

Register both in `server/src/accounts/accounts.module.ts` (`controllers: [BankAccountsController, SavingsAccountsController]`, `providers: [BankAccountsService, SavingsAccountsService]`, export both services).

- [ ] **Step 4: Run tests and commit**

Run: `npm test --workspace server -- savings`
Expected: PASS (4 tests).

```bash
git add server/src/accounts/ server/test/savings-accounts.e2e.spec.ts
git commit -m "feat(server): add savings/investment accounts with value snapshots"
```

---

### Task 6: Commitments module

**Files:**
- Create: `server/src/commitments/commitments.module.ts`, `server/src/commitments/commitments.service.ts`, `server/src/commitments/commitments.controller.ts`, `server/src/commitments/dto.ts`
- Modify: `server/src/app.module.ts` (import CommitmentsModule)
- Test: `server/test/commitments.e2e.spec.ts`

**Interfaces:**
- Consumes: `Commitment` + `Transaction` models, date helpers from `common/dates.ts`, `AuthGuard`, `AuditLogService`.
- Produces:
  - `GET /api/commitments` → `CommitmentDto[]` (status computed from `commitmentStatus(nextDueDate)`).
  - `POST /api/commitments` body `{ name, amount, dueDayOfMonth }` → `CommitmentDto` (nextDueDate = `nextDueDateFrom(dueDayOfMonth)`).
  - `PATCH /api/commitments/:id` body `{ name?, amount?, dueDayOfMonth?, active? }` → `CommitmentDto`; changing `dueDayOfMonth` recomputes `nextDueDate` from today.
  - `DELETE /api/commitments/:id` → `{ ok: true }`; 409 if referenced by transactions.
  - `CommitmentsService.mustOwn(userId, id)` exported for TransactionsService.

- [ ] **Step 1: Write the failing e2e test**

`server/test/commitments.e2e.spec.ts`:
```ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('commitments', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'com@user.com'));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('creates a commitment with a computed next due date and status', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/commitments')
      .set('Cookie', cookie)
      .send({ name: 'Rent', amount: 150000, dueDayOfMonth: 1 })
      .expect(201);
    expect(res.body.nextDueDate).toBeDefined();
    expect(['overdue', 'dueSoon', 'upcoming']).toContain(res.body.status);
    expect(new Date(res.body.nextDueDate).getUTCDate()).toBeLessThanOrEqual(31);
  });

  it('updates amount and recomputes due date when the day changes', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/commitments')
      .set('Cookie', cookie);
    const id = list.body[0].id;
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/commitments/${id}`)
      .set('Cookie', cookie)
      .send({ amount: 160000, dueDayOfMonth: 15 })
      .expect(200);
    expect(res.body.amount).toBe(160000);
    expect(new Date(res.body.nextDueDate).getUTCDate()).toBe(15);
  });

  it('deactivates a commitment', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/commitments')
      .set('Cookie', cookie);
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/commitments/${list.body[0].id}`)
      .set('Cookie', cookie)
      .send({ active: false })
      .expect(200);
    expect(res.body.active).toBe(false);
  });

  it('deletes an unreferenced commitment', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/commitments')
      .set('Cookie', cookie);
    await request(ctx.app.getHttpServer())
      .delete(`/api/commitments/${list.body[0].id}`)
      .set('Cookie', cookie)
      .expect(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- commitments`
Expected: FAIL — 404 on `/api/commitments`.

- [ ] **Step 3: Implement the module**

`server/src/commitments/dto.ts`:
```ts
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCommitmentDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsInt()
  @Min(1)
  amount: number;

  @IsInt()
  @Min(1)
  @Max(31)
  dueDayOfMonth: number;
}

export class UpdateCommitmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDayOfMonth?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

`server/src/commitments/commitments.service.ts`:
```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CommitmentDto } from '@finance/shared';
import {
  Commitment,
  CommitmentDocument,
} from '../database/schemas/commitment.schema';
import { Transaction } from '../database/schemas/transaction.schema';
import { commitmentStatus, nextDueDateFrom } from '../common/dates';
import { AuditLogService } from '../audit/audit.service';
import { CreateCommitmentDto, UpdateCommitmentDto } from './dto';

@Injectable()
export class CommitmentsService {
  constructor(
    @InjectModel(Commitment.name) private model: Model<Commitment>,
    @InjectModel(Transaction.name) private txnModel: Model<Transaction>,
    private audit: AuditLogService,
  ) {}

  toDto(doc: CommitmentDocument): CommitmentDto {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      amount: doc.amount,
      dueDayOfMonth: doc.dueDayOfMonth,
      nextDueDate: doc.nextDueDate.toISOString(),
      active: doc.active,
      status: commitmentStatus(doc.nextDueDate),
    };
  }

  async mustOwn(userId: string, id: string): Promise<CommitmentDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async list(userId: string): Promise<CommitmentDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ nextDueDate: 1 });
    return docs.map((d) => this.toDto(d));
  }

  async create(
    userId: string,
    dto: CreateCommitmentDto,
  ): Promise<CommitmentDto> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      amount: dto.amount,
      dueDayOfMonth: dto.dueDayOfMonth,
      nextDueDate: nextDueDateFrom(dto.dueDayOfMonth),
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

  async update(
    userId: string,
    id: string,
    dto: UpdateCommitmentDto,
  ): Promise<CommitmentDto> {
    const doc = await this.mustOwn(userId, id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.amount !== undefined) doc.amount = dto.amount;
    if (dto.active !== undefined) doc.active = dto.active;
    if (
      dto.dueDayOfMonth !== undefined &&
      dto.dueDayOfMonth !== doc.dueDayOfMonth
    ) {
      doc.dueDayOfMonth = dto.dueDayOfMonth;
      doc.nextDueDate = nextDueDateFrom(dto.dueDayOfMonth);
    }
    await doc.save();
    await this.audit.log({
      userId,
      action: 'commitment.updated',
      entityType: 'Commitment',
      entityId: id,
      metadata: { name: doc.name },
    });
    return this.toDto(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.mustOwn(userId, id);
    const inUse = await this.txnModel.exists({ linkedEntityId: doc._id });
    if (inUse) {
      throw new ConflictException(
        'Commitment has payment transactions. Delete them first.',
      );
    }
    await doc.deleteOne();
    await this.audit.log({
      userId,
      action: 'commitment.deleted',
      entityType: 'Commitment',
      entityId: id,
      metadata: { name: doc.name },
    });
  }
}
```

`server/src/commitments/commitments.controller.ts`:
```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/session.service';
import { CommitmentsService } from './commitments.service';
import { CreateCommitmentDto, UpdateCommitmentDto } from './dto';

@Controller('commitments')
@UseGuards(AuthGuard)
export class CommitmentsController {
  constructor(private service: CommitmentsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCommitmentDto) {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateCommitmentDto,
  ) {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.remove(user.userId, id);
    return { ok: true };
  }
}
```

`server/src/commitments/commitments.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { CommitmentsService } from './commitments.service';
import { CommitmentsController } from './commitments.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CommitmentsController],
  providers: [CommitmentsService],
  exports: [CommitmentsService],
})
export class CommitmentsModule {}
```

Add `CommitmentsModule` to `server/src/app.module.ts` imports.

- [ ] **Step 4: Run tests and commit**

Run: `npm test --workspace server -- commitments`
Expected: PASS (4 tests).

```bash
git add server/src/commitments/ server/src/app.module.ts server/test/commitments.e2e.spec.ts
git commit -m "feat(server): add commitments CRUD with auto-generated due dates"
```

---

### Task 7: Loans + credit cards modules

**Files:**
- Create: `server/src/loans/loans.module.ts`, `server/src/loans/loans.service.ts`, `server/src/loans/loans.controller.ts`, `server/src/loans/dto.ts`
- Create: `server/src/credit-cards/credit-cards.module.ts`, `server/src/credit-cards/credit-cards.service.ts`, `server/src/credit-cards/credit-cards.controller.ts`, `server/src/credit-cards/dto.ts`
- Modify: `server/src/app.module.ts` (import both)
- Test: `server/test/loans-cards.e2e.spec.ts`

**Interfaces:**
- Consumes: `Loan`, `CreditCard`, `Transaction` models; `dueDateInMonth` from `common/dates.ts`; `AuthGuard`; `AuditLogService`.
- Produces:
  - `GET|POST /api/loans`, `PATCH|DELETE /api/loans/:id` — create body `{ name, principal, interestRate, currentBalance?, startDate? }` (currentBalance defaults to principal); update body `{ name?, interestRate? }`; delete 409s when referenced.
  - `GET|POST /api/credit-cards`, `PATCH|DELETE /api/credit-cards/:id` — create body `{ name, creditLimit, statementDay, dueDay, currentBalance? }`; update body `{ name?, creditLimit?, statementDay?, dueDay? }`; delete 409s when referenced.
  - Lazy statement roll: on every list/read, if the most recent statement date (`statementDay`, current or previous month) is newer than `lastStatementAt`, set `statementBalance = currentBalance` and advance `lastStatementAt`.
  - `LoansService.mustOwn(userId, id)` and `CreditCardsService.mustOwn(userId, id)` exported for TransactionsService.

- [ ] **Step 1: Write the failing e2e test**

`server/test/loans-cards.e2e.spec.ts`:
```ts
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';
import { CreditCard } from '../src/database/schemas/credit-card.schema';

describe('loans and credit cards', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'lc@user.com'));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('creates a loan defaulting currentBalance to principal', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/loans')
      .set('Cookie', cookie)
      .send({ name: 'Car loan', principal: 5000000, interestRate: 3.5 })
      .expect(201);
    expect(res.body.currentBalance).toBe(5000000);
  });

  it('creates a loan with an explicit mid-life balance', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/loans')
      .set('Cookie', cookie)
      .send({
        name: 'Study loan',
        principal: 3000000,
        interestRate: 1.0,
        currentBalance: 1200000,
      })
      .expect(201);
    expect(res.body.currentBalance).toBe(1200000);
  });

  it('creates a credit card with zero balances', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/credit-cards')
      .set('Cookie', cookie)
      .send({ name: 'Visa', creditLimit: 1000000, statementDay: 5, dueDay: 25 })
      .expect(201);
    expect(res.body.currentBalance).toBe(0);
    expect(res.body.statementBalance).toBe(0);
  });

  it('rolls the statement lazily when a statement date has passed', async () => {
    const cardModel: Model<CreditCard> = ctx.app.get(
      getModelToken(CreditCard.name),
    );
    // Simulate: charges accrued, and lastStatementAt is two months old.
    await cardModel.updateOne(
      {},
      {
        currentBalance: 45000,
        lastStatementAt: new Date(Date.now() - 62 * 24 * 3600 * 1000),
      },
    );
    const res = await request(ctx.app.getHttpServer())
      .get('/api/credit-cards')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body[0].statementBalance).toBe(45000);
  });

  it('rejects a statementDay above 28', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/credit-cards')
      .set('Cookie', cookie)
      .send({ name: 'Bad', creditLimit: 1, statementDay: 31, dueDay: 25 })
      .expect(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- loans-cards`
Expected: FAIL — 404 on `/api/loans`.

- [ ] **Step 3: Implement the loans module**

`server/src/loans/dto.ts`:
```ts
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateLoanDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsInt()
  @Min(1)
  principal: number;

  @IsNumber()
  @Min(0)
  interestRate: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentBalance?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;
}

export class UpdateLoanDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  interestRate?: number;
}
```

`server/src/loans/loans.service.ts`:
```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoanDto } from '@finance/shared';
import { Loan, LoanDocument } from '../database/schemas/loan.schema';
import { Transaction } from '../database/schemas/transaction.schema';
import { AuditLogService } from '../audit/audit.service';
import { CreateLoanDto, UpdateLoanDto } from './dto';

@Injectable()
export class LoansService {
  constructor(
    @InjectModel(Loan.name) private model: Model<Loan>,
    @InjectModel(Transaction.name) private txnModel: Model<Transaction>,
    private audit: AuditLogService,
  ) {}

  toDto(doc: LoanDocument): LoanDto {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      principal: doc.principal,
      interestRate: doc.interestRate,
      currentBalance: doc.currentBalance,
      startDate: doc.startDate.toISOString(),
    };
  }

  async mustOwn(userId: string, id: string): Promise<LoanDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async list(userId: string): Promise<LoanDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 });
    return docs.map((d) => this.toDto(d));
  }

  async create(userId: string, dto: CreateLoanDto): Promise<LoanDto> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      principal: dto.principal,
      interestRate: dto.interestRate,
      currentBalance: dto.currentBalance ?? dto.principal,
      startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
    });
    await this.audit.log({
      userId,
      action: 'loan.created',
      entityType: 'Loan',
      entityId: doc._id.toHexString(),
      metadata: { name: dto.name, principal: dto.principal },
    });
    return this.toDto(doc);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateLoanDto,
  ): Promise<LoanDto> {
    const doc = await this.mustOwn(userId, id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.interestRate !== undefined) doc.interestRate = dto.interestRate;
    await doc.save();
    await this.audit.log({
      userId,
      action: 'loan.updated',
      entityType: 'Loan',
      entityId: id,
      metadata: { name: doc.name },
    });
    return this.toDto(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.mustOwn(userId, id);
    const inUse = await this.txnModel.exists({ linkedEntityId: doc._id });
    if (inUse) {
      throw new ConflictException(
        'Loan has payment transactions. Delete them first.',
      );
    }
    await doc.deleteOne();
    await this.audit.log({
      userId,
      action: 'loan.deleted',
      entityType: 'Loan',
      entityId: id,
      metadata: { name: doc.name },
    });
  }
}
```

`server/src/loans/loans.controller.ts`:
```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/session.service';
import { LoansService } from './loans.service';
import { CreateLoanDto, UpdateLoanDto } from './dto';

@Controller('loans')
@UseGuards(AuthGuard)
export class LoansController {
  constructor(private service: LoansService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateLoanDto) {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateLoanDto,
  ) {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.remove(user.userId, id);
    return { ok: true };
  }
}
```

`server/src/loans/loans.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
```

- [ ] **Step 4: Implement the credit cards module**

`server/src/credit-cards/dto.ts`:
```ts
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCreditCardDto {
  @IsString()
  @MaxLength(60)
  name: string;

  @IsInt()
  @Min(1)
  creditLimit: number;

  @IsInt()
  @Min(1)
  @Max(28)
  statementDay: number;

  @IsInt()
  @Min(1)
  @Max(28)
  dueDay: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentBalance?: number;
}

export class UpdateCreditCardDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  creditLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  statementDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  dueDay?: number;
}
```

`server/src/credit-cards/credit-cards.service.ts`:
```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreditCardDto } from '@finance/shared';
import {
  CreditCard,
  CreditCardDocument,
} from '../database/schemas/credit-card.schema';
import { Transaction } from '../database/schemas/transaction.schema';
import { dueDateInMonth } from '../common/dates';
import { AuditLogService } from '../audit/audit.service';
import { CreateCreditCardDto, UpdateCreditCardDto } from './dto';

function latestStatementDate(statementDay: number, now = new Date()): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonth = dueDateInMonth(y, m, statementDay);
  return thisMonth <= now ? thisMonth : dueDateInMonth(y, m - 1, statementDay);
}

@Injectable()
export class CreditCardsService {
  constructor(
    @InjectModel(CreditCard.name) private model: Model<CreditCard>,
    @InjectModel(Transaction.name) private txnModel: Model<Transaction>,
    private audit: AuditLogService,
  ) {}

  toDto(doc: CreditCardDocument): CreditCardDto {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      creditLimit: doc.creditLimit,
      statementBalance: doc.statementBalance,
      currentBalance: doc.currentBalance,
      statementDay: doc.statementDay,
      dueDay: doc.dueDay,
    };
  }

  private async ensureStatementCurrent(
    doc: CreditCardDocument,
  ): Promise<CreditCardDocument> {
    const latest = latestStatementDate(doc.statementDay);
    if (doc.lastStatementAt < latest) {
      doc.statementBalance = doc.currentBalance;
      doc.lastStatementAt = latest;
      await doc.save();
    }
    return doc;
  }

  async mustOwn(userId: string, id: string): Promise<CreditCardDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async list(userId: string): Promise<CreditCardDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 });
    const rolled = await Promise.all(
      docs.map((d) => this.ensureStatementCurrent(d)),
    );
    return rolled.map((d) => this.toDto(d));
  }

  async create(
    userId: string,
    dto: CreateCreditCardDto,
  ): Promise<CreditCardDto> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      creditLimit: dto.creditLimit,
      statementDay: dto.statementDay,
      dueDay: dto.dueDay,
      currentBalance: dto.currentBalance ?? 0,
      statementBalance: 0,
      lastStatementAt: new Date(),
    });
    await this.audit.log({
      userId,
      action: 'creditCard.created',
      entityType: 'CreditCard',
      entityId: doc._id.toHexString(),
      metadata: { name: dto.name, creditLimit: dto.creditLimit },
    });
    return this.toDto(doc);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCreditCardDto,
  ): Promise<CreditCardDto> {
    const doc = await this.mustOwn(userId, id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.creditLimit !== undefined) doc.creditLimit = dto.creditLimit;
    if (dto.statementDay !== undefined) doc.statementDay = dto.statementDay;
    if (dto.dueDay !== undefined) doc.dueDay = dto.dueDay;
    await doc.save();
    await this.audit.log({
      userId,
      action: 'creditCard.updated',
      entityType: 'CreditCard',
      entityId: id,
      metadata: { name: doc.name },
    });
    return this.toDto(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.mustOwn(userId, id);
    const inUse = await this.txnModel.exists({ linkedEntityId: doc._id });
    if (inUse) {
      throw new ConflictException(
        'Card has transactions. Delete them first.',
      );
    }
    await doc.deleteOne();
    await this.audit.log({
      userId,
      action: 'creditCard.deleted',
      entityType: 'CreditCard',
      entityId: id,
      metadata: { name: doc.name },
    });
  }
}
```

`server/src/credit-cards/credit-cards.controller.ts`:
```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/session.service';
import { CreditCardsService } from './credit-cards.service';
import { CreateCreditCardDto, UpdateCreditCardDto } from './dto';

@Controller('credit-cards')
@UseGuards(AuthGuard)
export class CreditCardsController {
  constructor(private service: CreditCardsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCreditCardDto) {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateCreditCardDto,
  ) {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.remove(user.userId, id);
    return { ok: true };
  }
}
```

`server/src/credit-cards/credit-cards.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { CreditCardsService } from './credit-cards.service';
import { CreditCardsController } from './credit-cards.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CreditCardsController],
  providers: [CreditCardsService],
  exports: [CreditCardsService],
})
export class CreditCardsModule {}
```

Add `LoansModule` and `CreditCardsModule` to `server/src/app.module.ts` imports.

- [ ] **Step 5: Run tests and commit**

Run: `npm test --workspace server -- loans-cards`
Expected: PASS (5 tests).

```bash
git add server/src/loans/ server/src/credit-cards/ server/src/app.module.ts server/test/loans-cards.e2e.spec.ts
git commit -m "feat(server): add loans and credit cards with lazy statement roll"
```

---

### Task 8: Transactions — create with atomic balance effects

**Files:**
- Create: `server/src/transactions/transactions.module.ts`, `server/src/transactions/transactions.service.ts`, `server/src/transactions/transactions.controller.ts`, `server/src/transactions/dto.ts`
- Modify: `server/src/app.module.ts` (import TransactionsModule)
- Test: `server/test/transactions-create.e2e.spec.ts`

**Interfaces:**
- Consumes: all financial models, `Connection` (for sessions), `BankAccountsService.mustOwn`, `CommitmentsService.mustOwn`, `LoansService.mustOwn`, `CreditCardsService.mustOwn`, `shiftDueDate`, `AuditLogService`.
- Produces:
  - `POST /api/transactions` body `{ type, amount, date, category?, accountId?, toAccountId?, linkedEntityId?, note? }` → `TransactionDto`. Balance effects by type (all inside one Mongo transaction):
    - `income`: `accountId` +amount
    - `expense`: `accountId` −amount (category required)
    - `commitmentPayment`: `accountId` −amount; linked commitment's `nextDueDate` advances one month
    - `loanPayment`: `accountId` −amount; linked loan `currentBalance` −amount
    - `cardPayment`: `accountId` −amount; linked card `currentBalance` −amount and `statementBalance` −amount (may go negative = overpayment credit; kept unclamped so effects are exactly reversible)
    - `cardCharge`: linked card `currentBalance` +amount (no bank account)
    - `transfer`: `accountId` −amount; `toAccountId` +amount
  - `TransactionsService.applyEffect(txn, sign: 1 | -1, session)` — private; `-1` exactly reverses `+1` (used by Task 9).
  - Audits `transaction.created`.

- [ ] **Step 1: Write the failing e2e test**

`server/test/transactions-create.e2e.spec.ts`:
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
      .send({ type: 'income', amount: 300000, date: '2026-07-01', accountId })
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
      .send({ type: 'expense', amount: 5000, date: '2026-07-02', accountId })
      .expect(400);
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 5000,
        date: '2026-07-02',
        accountId,
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
        accountId,
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
        accountId,
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
        accountId,
        linkedEntityId: loanId,
      })
      .expect(201);
    const loans = await request(ctx.app.getHttpServer())
      .get('/api/loans')
      .set('Cookie', cookie);
    expect(loans.body[0].currentBalance).toBe(4920000);
  });

  it('cardCharge raises card balance; cardPayment lowers it and the bank', async () => {
    const server = ctx.app.getHttpServer();
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'cardCharge',
        amount: 20000,
        date: '2026-07-06',
        linkedEntityId: cardId,
      })
      .expect(201);
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'cardPayment',
        amount: 15000,
        date: '2026-07-07',
        accountId,
        linkedEntityId: cardId,
      })
      .expect(201);
    const cards = await request(server)
      .get('/api/credit-cards')
      .set('Cookie', cookie);
    expect(cards.body[0].currentBalance).toBe(5000);
  });

  it('rejects transfers to the same account', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'transfer',
        amount: 1,
        date: '2026-07-08',
        accountId,
        toAccountId: accountId,
      })
      .expect(400);
  });

  it('404s a transaction against another users account', async () => {
    const other = await seedAuthedUser(ctx.app, 'tx2@user.com');
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', other.cookie)
      .send({ type: 'income', amount: 1, date: '2026-07-09', accountId })
      .expect(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- transactions-create`
Expected: FAIL — 404 on `/api/transactions`.

- [ ] **Step 3: Implement DTOs and TransactionsService**

`server/src/transactions/dto.ts`:
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
import { EXPENSE_CATEGORIES, ExpenseCategory, TransactionType } from '@finance/shared';

const TYPES: TransactionType[] = [
  'income',
  'expense',
  'commitmentPayment',
  'loanPayment',
  'cardPayment',
  'cardCharge',
  'transfer',
];

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

  @IsOptional()
  @IsMongoId()
  accountId?: string;

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
  accountId?: string;

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

`server/src/transactions/transactions.service.ts`:
```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Paginated, TransactionDto } from '@finance/shared';
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
      accountId: doc.accountId?.toHexString(),
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
    if (dto.type !== 'cardCharge') {
      if (!dto.accountId) {
        throw new BadRequestException('accountId is required for this type.');
      }
      await this.bankAccounts.mustOwn(userId, dto.accountId);
    }
    if (dto.type === 'expense' && !dto.category) {
      throw new BadRequestException('category is required for expenses.');
    }
    if (dto.type === 'transfer') {
      if (!dto.toAccountId) {
        throw new BadRequestException('toAccountId is required for transfers.');
      }
      if (dto.toAccountId === dto.accountId) {
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
    if (dto.type === 'cardPayment' || dto.type === 'cardCharge') {
      await this.cards.mustOwn(userId, this.requireLink(dto));
    }
  }

  private async applyEffect(
    txn: TransactionDocument,
    sign: 1 | -1,
    session: ClientSession,
  ): Promise<void> {
    const amt = sign * txn.amount;
    const debitBank = () =>
      this.bankModel.updateOne(
        { _id: txn.accountId },
        { $inc: { currentBalance: -amt } },
        { session },
      );
    switch (txn.type) {
      case 'income':
        await this.bankModel.updateOne(
          { _id: txn.accountId },
          { $inc: { currentBalance: amt } },
          { session },
        );
        break;
      case 'expense':
        await debitBank();
        break;
      case 'commitmentPayment': {
        await debitBank();
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
        await debitBank();
        await this.loanModel.updateOne(
          { _id: txn.linkedEntityId },
          { $inc: { currentBalance: -amt } },
          { session },
        );
        break;
      case 'cardPayment':
        await debitBank();
        await this.cardModel.updateOne(
          { _id: txn.linkedEntityId },
          { $inc: { currentBalance: -amt, statementBalance: -amt } },
          { session },
        );
        break;
      case 'cardCharge':
        await this.cardModel.updateOne(
          { _id: txn.linkedEntityId },
          { $inc: { currentBalance: amt } },
          { session },
        );
        break;
      case 'transfer':
        await debitBank();
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
              accountId: dto.accountId
                ? new Types.ObjectId(dto.accountId)
                : undefined,
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
    if (q.accountId) {
      const oid = new Types.ObjectId(q.accountId);
      filter.$or = [{ accountId: oid }, { toAccountId: oid }];
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

- [ ] **Step 4: Implement controller and module (create endpoint only used this task; list/update/delete land in Task 9's tests)**

`server/src/transactions/transactions.controller.ts`:
```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/session.service';
import { TransactionsService } from './transactions.service';
import {
  CreateTransactionDto,
  ListTransactionsQuery,
  UpdateTransactionDto,
} from './dto';

@Controller('transactions')
@UseGuards(AuthGuard)
export class TransactionsController {
  constructor(private service: TransactionsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListTransactionsQuery,
  ) {
    return this.service.list(user.userId, query);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateTransactionDto,
  ) {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.remove(user.userId, id);
    return { ok: true };
  }
}
```

`server/src/transactions/transactions.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { LoansModule } from '../loans/loans.module';
import { CreditCardsModule } from '../credit-cards/credit-cards.module';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    AccountsModule,
    CommitmentsModule,
    LoansModule,
    CreditCardsModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
```

Add `TransactionsModule` to `server/src/app.module.ts` imports.

- [ ] **Step 5: Run tests and commit**

Run: `npm test --workspace server -- transactions-create`
Expected: PASS (8 tests).

```bash
git add server/src/transactions/ server/src/app.module.ts server/test/transactions-create.e2e.spec.ts
git commit -m "feat(server): add transactions with atomic multi-entity balance effects"
```

---

### Task 9: Transactions — list filters, update, delete (reverse + reapply)

**Files:**
- Test: `server/test/transactions-mutate.e2e.spec.ts` (implementation already landed in Task 8; this task proves the reverse/reapply and filter behavior and fixes anything it flushes out)

**Interfaces:**
- Consumes: Task 8's endpoints.
- Produces: verified behavior for `GET /api/transactions` filters (`type`, `category`, `accountId`, `from`, `to`, `page`, `pageSize`), `PATCH /api/transactions/:id` (amount edits shift balances by the delta), `DELETE /api/transactions/:id` (exactly reverses the effect).

- [ ] **Step 1: Write the failing/verifying e2e test**

`server/test/transactions-mutate.e2e.spec.ts`:
```ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('transaction update/delete/list', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let accountId: string;

  async function balance(): Promise<number> {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    return res.body[0].currentBalance;
  }

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'mut@user.com'));
    accountId = (
      await request(ctx.app.getHttpServer())
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Main', openingBalance: 100000 })
    ).body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('editing the amount shifts the balance by the delta', async () => {
    const txn = (
      await request(ctx.app.getHttpServer())
        .post('/api/transactions')
        .set('Cookie', cookie)
        .send({
          type: 'expense',
          amount: 10000,
          date: '2026-07-01',
          accountId,
          category: 'Food',
        })
    ).body;
    expect(await balance()).toBe(90000);

    await request(ctx.app.getHttpServer())
      .patch(`/api/transactions/${txn.id}`)
      .set('Cookie', cookie)
      .send({ amount: 4000 })
      .expect(200);
    expect(await balance()).toBe(96000);
  });

  it('deleting a transaction restores the balance', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/transactions')
      .set('Cookie', cookie);
    await request(ctx.app.getHttpServer())
      .delete(`/api/transactions/${list.body.items[0].id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(await balance()).toBe(100000);
  });

  it('filters by type, category, and date range with pagination', async () => {
    const server = ctx.app.getHttpServer();
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'income', amount: 1000, date: '2026-06-01', accountId });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 500,
        date: '2026-07-05',
        accountId,
        category: 'Transport',
      });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 700,
        date: '2026-07-06',
        accountId,
        category: 'Food',
      });

    const byType = await request(server)
      .get('/api/transactions?type=expense')
      .set('Cookie', cookie)
      .expect(200);
    expect(byType.body.total).toBe(2);

    const byCategory = await request(server)
      .get('/api/transactions?category=Food')
      .set('Cookie', cookie);
    expect(byCategory.body.total).toBe(1);

    const byDate = await request(server)
      .get('/api/transactions?from=2026-07-01&to=2026-07-31')
      .set('Cookie', cookie);
    expect(byDate.body.total).toBe(2);

    const paged = await request(server)
      .get('/api/transactions?page=1&pageSize=2')
      .set('Cookie', cookie);
    expect(paged.body.items).toHaveLength(2);
    expect(paged.body.total).toBe(3);
    // newest date first
    expect(paged.body.items[0].date).toContain('2026-07-06');
  });

  it('rejects editing immutable fields via whitelist stripping', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/transactions')
      .set('Cookie', cookie);
    const txn = list.body.items.find(
      (t: { type: string }) => t.type === 'expense',
    );
    // type is not in UpdateTransactionDto; whitelist:true strips it silently,
    // so the type must remain unchanged.
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/transactions/${txn.id}`)
      .set('Cookie', cookie)
      .send({ type: 'income', amount: txn.amount })
      .expect(200);
    expect(res.body.type).toBe('expense');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test --workspace server -- transactions-mutate`
Expected: PASS if Task 8's implementation is correct — this task is the proof gate for reverse/reapply. If any assertion fails, fix `TransactionsService` (most likely `applyEffect` reversal or filter building) until green.

- [ ] **Step 3: Run the full suite and commit**

Run: `npm test --workspace server`
Expected: all PASS.

```bash
git add server/test/transactions-mutate.e2e.spec.ts server/src/transactions/
git commit -m "test(server): prove transaction reverse/reapply and list filters"
```

---

### Task 10: Balance recompute repair endpoint

**Files:**
- Modify: `server/src/accounts/bank-accounts.service.ts`, `server/src/accounts/bank-accounts.controller.ts`
- Test: `server/test/recompute.e2e.spec.ts`

**Interfaces:**
- Consumes: `BankAccount` + `Transaction` models.
- Produces: `POST /api/accounts/bank/:id/recompute` → `{ currentBalance: number; drift: number }` where drift = corrected − previous stored value. Recalculates from `openingBalance` + all transaction effects touching the account (income +, transfer-in +, all other accountId-bearing types −). Audits `bankAccount.recomputed` with the drift.

- [ ] **Step 1: Write the failing e2e test**

`server/test/recompute.e2e.spec.ts`:
```ts
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';
import { BankAccount } from '../src/database/schemas/bank-account.schema';

describe('balance recompute', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let accountId: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'rc@user.com'));
    const server = ctx.app.getHttpServer();
    accountId = (
      await request(server)
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Main', openingBalance: 100000 })
    ).body.id;
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
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('reports zero drift when balances are consistent', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/accounts/bank/${accountId}/recompute`)
      .set('Cookie', cookie)
      .expect(201);
    expect(res.body).toEqual({ currentBalance: 130000, drift: 0 });
  });

  it('repairs a corrupted stored balance and reports the drift', async () => {
    const model: Model<BankAccount> = ctx.app.get(
      getModelToken(BankAccount.name),
    );
    await model.updateOne({}, { currentBalance: 999999 });
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/accounts/bank/${accountId}/recompute`)
      .set('Cookie', cookie)
      .expect(201);
    expect(res.body.currentBalance).toBe(130000);
    expect(res.body.drift).toBe(130000 - 999999);
    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    expect(list.body[0].currentBalance).toBe(130000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace server -- recompute`
Expected: FAIL — 404 on the recompute route.

- [ ] **Step 3: Implement recompute**

Add to `server/src/accounts/bank-accounts.service.ts`:
```ts
  async recompute(
    userId: string,
    id: string,
  ): Promise<{ currentBalance: number; drift: number }> {
    const acc = await this.mustOwn(userId, id);
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
    const drift = balance - acc.currentBalance;
    acc.currentBalance = balance;
    await acc.save();
    await this.audit.log({
      userId,
      action: 'bankAccount.recomputed',
      entityType: 'BankAccount',
      entityId: id,
      metadata: { drift },
    });
    return { currentBalance: balance, drift };
  }
```

Add to `server/src/accounts/bank-accounts.controller.ts`:
```ts
  @Post(':id/recompute')
  recompute(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.recompute(user.userId, id);
  }
```
(add `Post` to the existing `@nestjs/common` import.)

- [ ] **Step 4: Run tests and commit**

Run: `npm test --workspace server -- recompute`
Expected: PASS (2 tests).

```bash
git add server/src/accounts/ server/test/recompute.e2e.spec.ts
git commit -m "feat(server): add balance recompute repair endpoint with drift reporting"
```

---

### Task 11: Client layout, money utilities, accounts page

**Files:**
- Create: `client/src/money.ts`, `client/src/Layout.tsx`, `client/src/pages/AccountsPage.tsx`
- Modify: `client/src/App.tsx` (wrap protected pages in Layout, add `/accounts` route)
- Test: `client/src/money.spec.ts`

**Interfaces:**
- Consumes: `/api/accounts/bank`, `/api/accounts/savings` endpoints; `BankAccountDto`, `SavingsAccountDto`, `ValueSnapshotDto` from `@finance/shared`.
- Produces:
  - `formatSen(sen: number): string` — `1234` → `"RM 12.34"` (thousands-separated, negative-aware).
  - `parseRM(input: string): number | null` — `"12.34"` → `1234`; null for invalid/negative input.
  - `Layout` — nav (Dashboard, Transactions, Accounts, Commitments, Loans, Credit Cards, Settings) + logout button; wraps protected routes.
  - `/accounts` page with bank accounts (create, rename, delete, recompute) and savings/investments (create, delete, log snapshot, view latest value).

- [ ] **Step 1: Write the failing money test**

`client/src/money.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatSen, parseRM } from './money';

describe('money', () => {
  it('formats sen as RM', () => {
    expect(formatSen(1234)).toBe('RM 12.34');
    expect(formatSen(0)).toBe('RM 0.00');
    expect(formatSen(150000000)).toBe('RM 1,500,000.00');
    expect(formatSen(-500)).toBe('-RM 5.00');
  });

  it('parses RM strings to sen', () => {
    expect(parseRM('12.34')).toBe(1234);
    expect(parseRM('1,500.00')).toBe(150000);
    expect(parseRM('0.005')).toBe(1); // rounds half up to nearest sen
    expect(parseRM('abc')).toBeNull();
    expect(parseRM('-5')).toBeNull();
    expect(parseRM('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace client`
Expected: FAIL — cannot find module `./money`.

- [ ] **Step 3: Implement money helpers**

`client/src/money.ts`:
```ts
export function formatSen(sen: number): string {
  const negative = sen < 0;
  const abs = Math.abs(sen);
  const rm = (abs / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? '-' : ''}RM ${rm}`;
}

export function parseRM(input: string): number | null {
  const cleaned = input.replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Math.round(parseFloat(cleaned) * 100);
  return Number.isSafeInteger(value) ? value : null;
}
```

Run: `npm test --workspace client` — expected PASS.

- [ ] **Step 4: Implement Layout and AccountsPage**

`client/src/Layout.tsx`:
```tsx
import { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth-context';

const LINKS = [
  ['/dashboard', 'Dashboard'],
  ['/transactions', 'Transactions'],
  ['/accounts', 'Accounts'],
  ['/commitments', 'Commitments'],
  ['/loans', 'Loans'],
  ['/credit-cards', 'Credit Cards'],
  ['/settings', 'Settings'],
] as const;

export default function Layout({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    await refresh();
    navigate('/login');
  }

  return (
    <div>
      <nav>
        {LINKS.map(([to, label]) => (
          <NavLink key={to} to={to}>
            {label}
          </NavLink>
        ))}
        <span>{user?.email}</span>
        <button onClick={logout}>Log out</button>
      </nav>
      <div>{children}</div>
    </div>
  );
}
```

`client/src/pages/AccountsPage.tsx`:
```tsx
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  BankAccountDto,
  SavingsAccountDto,
  ValueSnapshotDto,
} from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';

export default function AccountsPage() {
  const [banks, setBanks] = useState<BankAccountDto[]>([]);
  const [savings, setSavings] = useState<SavingsAccountDto[]>([]);
  const [error, setError] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankOpening, setBankOpening] = useState('');
  const [savName, setSavName] = useState('');
  const [savType, setSavType] = useState<'savings' | 'investment'>('savings');
  const [snapshotsFor, setSnapshotsFor] = useState<string | null>(null);
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
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function renameBank(id: string) {
    const name = window.prompt('New name?');
    if (!name) return;
    try {
      await api(`/accounts/bank/${id}`, { method: 'PATCH', body: { name } });
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
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function deleteSavings(id: string) {
    try {
      await api(`/accounts/savings/${id}`, { method: 'DELETE' });
      if (snapshotsFor === id) setSnapshotsFor(null);
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function openSnapshots(id: string) {
    setSnapshotsFor(id);
    setSnapshots(await api<ValueSnapshotDto[]>(`/accounts/savings/${id}/snapshots`));
  }

  async function addSnapshot(e: FormEvent) {
    e.preventDefault();
    if (!snapshotsFor) return;
    const value = parseRM(snapValue);
    if (value === null || !snapDate) return setError('Invalid snapshot input.');
    try {
      await api(`/accounts/savings/${snapshotsFor}/snapshots`, {
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
    <main>
      <h1>Accounts</h1>
      {error && <p role="alert">{error}</p>}

      <section>
        <h2>Bank accounts</h2>
        <ul>
          {banks.map((b) => (
            <li key={b.id}>
              {b.name}: {formatSen(b.currentBalance)}{' '}
              <button onClick={() => renameBank(b.id)}>Rename</button>{' '}
              <button onClick={() => recompute(b.id)}>Verify balance</button>{' '}
              <button onClick={() => deleteBank(b.id)}>Delete</button>
            </li>
          ))}
        </ul>
        <form onSubmit={addBank}>
          <input
            placeholder="Account name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            required
          />
          <input
            placeholder="Opening balance (RM)"
            value={bankOpening}
            onChange={(e) => setBankOpening(e.target.value)}
            required
          />
          <button type="submit">Add bank account</button>
        </form>
      </section>

      <section>
        <h2>Savings & investments</h2>
        <ul>
          {savings.map((s) => (
            <li key={s.id}>
              {s.name} ({s.type}):{' '}
              {s.latestValue === null ? 'no value yet' : formatSen(s.latestValue)}{' '}
              <button onClick={() => openSnapshots(s.id)}>Snapshots</button>{' '}
              <button onClick={() => deleteSavings(s.id)}>Delete</button>
            </li>
          ))}
        </ul>
        <form onSubmit={addSavings}>
          <input
            placeholder="Name"
            value={savName}
            onChange={(e) => setSavName(e.target.value)}
            required
          />
          <select
            value={savType}
            onChange={(e) => setSavType(e.target.value as 'savings' | 'investment')}
          >
            <option value="savings">Savings</option>
            <option value="investment">Investment</option>
          </select>
          <button type="submit">Add</button>
        </form>

        {snapshotsFor && (
          <div>
            <h3>Value history</h3>
            <ul>
              {snapshots.map((s) => (
                <li key={s.id}>
                  {s.date.slice(0, 10)}: {formatSen(s.value)}
                </li>
              ))}
            </ul>
            <form onSubmit={addSnapshot}>
              <input
                type="date"
                value={snapDate}
                onChange={(e) => setSnapDate(e.target.value)}
                required
              />
              <input
                placeholder="Value (RM)"
                value={snapValue}
                onChange={(e) => setSnapValue(e.target.value)}
                required
              />
              <button type="submit">Log value</button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
```

Update `client/src/App.tsx`: import `Layout` and `AccountsPage`; wrap each protected page as `<ProtectedRoute><Layout><AccountsPage /></Layout></ProtectedRoute>` and do the same for the existing `/dashboard` and `/settings` routes; add:
```tsx
          <Route
            path="/accounts"
            element={
              <ProtectedRoute>
                <Layout>
                  <AccountsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
```
`DashboardPage`'s own header/logout becomes redundant once Layout provides it — remove the header from `DashboardPage`, keeping just the placeholder text.

- [ ] **Step 5: Verify and commit**

Run: `npm run build --workspace client && npm test --workspace client`
Expected: clean build, money + api tests PASS.
Manual: with server + mongo running, exercise the accounts page (add bank account, add savings, log snapshot, verify balance).

```bash
git add client/src/
git commit -m "feat(client): add layout nav, money utils, and accounts page"
```

---

### Task 12: Client commitments, loans, credit cards pages

**Files:**
- Create: `client/src/pages/CommitmentsPage.tsx`, `client/src/pages/LoansPage.tsx`, `client/src/pages/CreditCardsPage.tsx`
- Modify: `client/src/App.tsx` (add the three routes, wrapped like `/accounts`)

**Interfaces:**
- Consumes: `/api/commitments`, `/api/loans`, `/api/credit-cards`; DTOs from `@finance/shared`; `formatSen`/`parseRM`.
- Produces: list + create + delete UI per entity; commitments show status and next due date; loans show payoff progress; cards show statement/current/limit.

- [ ] **Step 1: Write the pages**

`client/src/pages/CommitmentsPage.tsx`:
```tsx
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CommitmentDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';

const STATUS_LABEL = {
  overdue: 'OVERDUE',
  dueSoon: 'Due soon',
  upcoming: 'Upcoming',
} as const;

export default function CommitmentsPage() {
  const [items, setItems] = useState<CommitmentDto[]>([]);
  const [error, setError] = useState('');
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
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function toggleActive(c: CommitmentDto) {
    await api(`/commitments/${c.id}`, {
      method: 'PATCH',
      body: { active: !c.active },
    });
    await load();
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
    <main>
      <h1>Commitments</h1>
      {error && <p role="alert">{error}</p>}
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            {c.name}: {formatSen(c.amount)} — due{' '}
            {c.nextDueDate.slice(0, 10)} [{STATUS_LABEL[c.status]}]
            {!c.active && ' (inactive)'}{' '}
            <button onClick={() => toggleActive(c)}>
              {c.active ? 'Deactivate' : 'Activate'}
            </button>{' '}
            <button onClick={() => remove(c.id)}>Delete</button>
          </li>
        ))}
      </ul>
      <form onSubmit={add}>
        <input
          placeholder="Name (e.g. Rent)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          placeholder="Amount (RM)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <label>
          Due day of month
          <input
            type="number"
            min={1}
            max={31}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            required
          />
        </label>
        <button type="submit">Add commitment</button>
      </form>
    </main>
  );
}
```

`client/src/pages/LoansPage.tsx`:
```tsx
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { LoanDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';

export default function LoansPage() {
  const [items, setItems] = useState<LoanDto[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [balance, setBalance] = useState('');

  const load = useCallback(async () => {
    setItems(await api<LoanDto[]>('/loans'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    const principalSen = parseRM(principal);
    if (principalSen === null) return setError('Invalid principal.');
    const balanceSen = balance ? parseRM(balance) : null;
    if (balance && balanceSen === null) return setError('Invalid balance.');
    try {
      await api('/loans', {
        method: 'POST',
        body: {
          name,
          principal: principalSen,
          interestRate: parseFloat(rate) || 0,
          ...(balanceSen !== null ? { currentBalance: balanceSen } : {}),
        },
      });
      setName('');
      setPrincipal('');
      setRate('');
      setBalance('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function remove(id: string) {
    try {
      await api(`/loans/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  return (
    <main>
      <h1>Loans</h1>
      {error && <p role="alert">{error}</p>}
      <ul>
        {items.map((l) => {
          const paidPct =
            l.principal > 0
              ? Math.round(((l.principal - l.currentBalance) / l.principal) * 100)
              : 0;
          return (
            <li key={l.id}>
              {l.name}: {formatSen(l.currentBalance)} remaining of{' '}
              {formatSen(l.principal)} ({paidPct}% paid, {l.interestRate}% p.a.){' '}
              <button onClick={() => remove(l.id)}>Delete</button>
            </li>
          );
        })}
      </ul>
      <form onSubmit={add}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          placeholder="Principal (RM)"
          value={principal}
          onChange={(e) => setPrincipal(e.target.value)}
          required
        />
        <input
          placeholder="Interest rate % p.a."
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
        <input
          placeholder="Current balance (RM, optional)"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
        />
        <button type="submit">Add loan</button>
      </form>
    </main>
  );
}
```

`client/src/pages/CreditCardsPage.tsx`:
```tsx
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
```

Add the three routes to `client/src/App.tsx`, each wrapped in `<ProtectedRoute><Layout>...</Layout></ProtectedRoute>` exactly like `/accounts`: `/commitments` → `CommitmentsPage`, `/loans` → `LoansPage`, `/credit-cards` → `CreditCardsPage`.

- [ ] **Step 2: Verify and commit**

Run: `npm run build --workspace client && npm test --workspace client`
Expected: clean.
Manual: create one of each entity through the UI, confirm they list correctly.

```bash
git add client/src/
git commit -m "feat(client): add commitments, loans, and credit cards pages"
```

---

### Task 13: Client transactions page

**Files:**
- Create: `client/src/pages/TransactionsPage.tsx`
- Modify: `client/src/App.tsx` (add `/transactions` route, wrapped like the others)

**Interfaces:**
- Consumes: `/api/transactions` (all verbs), the four entity list endpoints (to populate selectors), `EXPENSE_CATEGORIES`, `TransactionType`, DTOs from `@finance/shared`.
- Produces: an add-transaction form whose fields adapt to the selected type (per the requirement matrix in Plan 2 Task 8's Interfaces), plus a filterable, paginated history table with per-row edit (amount/note) and delete.

- [ ] **Step 1: Write the page**

`client/src/pages/TransactionsPage.tsx`:
```tsx
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
```

Add the `/transactions` route to `client/src/App.tsx` wrapped in `<ProtectedRoute><Layout>...</Layout></ProtectedRoute>`.

- [ ] **Step 2: Verify and commit**

Run: `npm run build --workspace client && npm test --workspace client`
Expected: clean.
Manual full-flow: add one transaction of every type through the UI and confirm the affected balances on `/accounts`, `/loans`, `/credit-cards`, and `/commitments` all move as described in Task 8's effect matrix; edit and delete a transaction and watch the balance restore.

```bash
git add client/src/
git commit -m "feat(client): add transactions page with type-adaptive form and history"
```

---

## Out of Scope for Plan 2

- Dashboard aggregation endpoints and all charts → Plan 3.
- Production deployment → Plan 3.
- Category management UI, recurring auto-transactions, CSV import — not in the v1 spec.
