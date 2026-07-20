# MCP Agent Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user connect an agent (Claude Code CLI) to their finance tracker via a bearer-token-authenticated MCP endpoint exposing `create_transaction`, `get_summary`, `list_transactions`, and `list_accounts` tools, with a Settings sub-page to generate/rotate the token and copy the connection command.

**Architecture:** New `server/src/agent/` NestJS module owns an `ApiToken` schema (hashed bearer token, one per user), a `BearerAuthGuard` parallel to the existing cookie `AuthGuard`, a status/rotate REST controller (cookie-guarded), and an `McpController` at `POST /mcp` (bearer-guarded) that builds a stateless `@modelcontextprotocol/sdk` `McpServer` per request. Tool handlers delegate to existing domain services (`TransactionsService`, `DashboardService`, `BankAccountsService`, `CommitmentsService`, `LoansService`, `CreditCardsService`) — no duplicated business logic. A new `client/src/pages/AgentPage.tsx` at `/settings/agent` drives token generation and shows the copy-paste `claude mcp add` command.

**Tech Stack:** NestJS, Mongoose, `@modelcontextprotocol/sdk` (^1.29.0), `zod` (^4.4.3) for MCP tool input schemas, React + `api.ts` fetch helper on the client.

## Global Constraints

- All monetary values are integer sen; never floats. (spec: money & dates)
- Dates for recurring due-date math go through `server/src/common/dates.ts` helpers — not ad hoc arithmetic. (spec: money & dates)
- Bearer token is stored only as a `sha256` hash, never plaintext, matching `SessionService`'s `hashToken` pattern. (spec: architecture)
- One active token per user; rotating overwrites the old hash immediately (no grace window). (spec: decisions)
- v1 has no edit/delete MCP tools — only create + read. (spec: decisions)
- MCP tools execute immediately, no dry-run/confirm step. (spec: decisions)
- Agent-originated audit entries are tagged `actor: 'agent'`; all existing call sites default to `actor: 'user'` implicitly. (spec: decisions)
- New schemas are registered in the `@Global()` `DatabaseModule`, not per-domain modules. (CLAUDE.md)
- Rebuild `shared` (`npm run build:shared`) after any change to `shared/src`. (CLAUDE.md)

---

### Task 1: Add MCP SDK dependencies

**Files:**
- Modify: `server/package.json`

**Interfaces:**
- Produces: `@modelcontextprotocol/sdk` and `zod` importable from `server/src/**`.

- [ ] **Step 1: Add the dependencies**

Run:
```bash
npm install @modelcontextprotocol/sdk@^1.29.0 zod@^4.4.3 --workspace server
```

- [ ] **Step 2: Verify install**

Run: `npm ls @modelcontextprotocol/sdk zod --workspace server`
Expected: both packages listed with the installed versions, no `UNMET DEPENDENCY` errors.

- [ ] **Step 3: Commit**

```bash
git add server/package.json package-lock.json
git commit -m "chore: add @modelcontextprotocol/sdk and zod for agent MCP endpoint"
```

---

### Task 2: `ApiToken` schema

**Files:**
- Create: `server/src/database/schemas/api-token.schema.ts`
- Modify: `server/src/database/database.module.ts`
- Test: `server/src/database/schemas/api-token.schema.spec.ts`

**Interfaces:**
- Produces: `ApiToken` class, `ApiTokenDocument` type, `ApiTokenSchema` — `{ userId: ObjectId (unique index), tokenHash: string, createdAt: Date, lastUsedAt?: Date }`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/database/schemas/api-token.schema.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ApiToken, ApiTokenSchema } from './api-token.schema';

describe('ApiToken schema', () => {
  let mongod: MongoMemoryReplSet;
  let model: Model<ApiToken>;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri('agent-token-test')),
        MongooseModule.forFeature([{ name: ApiToken.name, schema: ApiTokenSchema }]),
      ],
    }).compile();
    model = moduleRef.get(getModelToken(ApiToken.name));
  });

  afterAll(async () => {
    await mongod.stop();
  });

  it('enforces one token document per user', async () => {
    const userId = new Types.ObjectId();
    await model.create({ userId, tokenHash: 'hash-1', createdAt: new Date() });
    await expect(
      model.create({ userId, tokenHash: 'hash-2', createdAt: new Date() }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/database/schemas/api-token.schema.spec.ts --workspace server`
Expected: FAIL — `Cannot find module './api-token.schema'`

- [ ] **Step 3: Write the schema**

```typescript
// server/src/database/schemas/api-token.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ApiTokenDocument = HydratedDocument<ApiToken>;

@Schema()
export class ApiToken {
  @Prop({ type: Types.ObjectId, required: true, unique: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  tokenHash: string;

  @Prop({ required: true })
  createdAt: Date;

  @Prop()
  lastUsedAt?: Date;
}

export const ApiTokenSchema = SchemaFactory.createForClass(ApiToken);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/database/schemas/api-token.schema.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 5: Register the schema in `DatabaseModule`**

In `server/src/database/database.module.ts`, add the import near the other schema imports:

```typescript
import { ApiToken, ApiTokenSchema } from './schemas/api-token.schema';
```

and add `{ name: ApiToken.name, schema: ApiTokenSchema }` to the `models` array (after the `NetWorthSnapshot` entry).

- [ ] **Step 6: Run the full server test suite to confirm nothing broke**

Run: `npm test --workspace server`
Expected: PASS (all existing + new test)

- [ ] **Step 7: Commit**

```bash
git add server/src/database/schemas/api-token.schema.ts server/src/database/schemas/api-token.schema.spec.ts server/src/database/database.module.ts
git commit -m "feat: add ApiToken schema for agent bearer tokens"
```

---

### Task 3: `AgentTokenService` (rotate/status)

**Files:**
- Create: `server/src/agent/agent-token.service.ts`
- Test: `server/src/agent/agent-token.service.spec.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `ApiToken` model (Task 2).
- Produces: `AgentTokenService.rotate(userId: string): Promise<string>` (returns plaintext token), `AgentTokenService.status(userId: string): Promise<AgentTokenStatusDto>`, `AgentTokenService.resolve(token: string): Promise<{ userId: string } | null>` (hashes + looks up + updates `lastUsedAt`, used by Task 4's guard).
- `AgentTokenStatusDto` (new shared type): `{ hasToken: boolean; createdAt: string | null; lastUsedAt: string | null }`.

- [ ] **Step 1: Add the shared DTO**

In `shared/src/index.ts`, append:

```typescript
// ---- Agent MCP endpoint DTOs ----

export interface AgentTokenStatusDto {
  hasToken: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}
```

Run: `npm run build:shared`
Expected: builds with no errors.

- [ ] **Step 2: Write the failing test**

```typescript
// server/src/agent/agent-token.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { ApiToken, ApiTokenSchema } from '../database/schemas/api-token.schema';
import { AgentTokenService } from './agent-token.service';

describe('AgentTokenService', () => {
  let mongod: MongoMemoryReplSet;
  let service: AgentTokenService;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri('agent-token-service-test')),
        MongooseModule.forFeature([{ name: ApiToken.name, schema: ApiTokenSchema }]),
      ],
      providers: [AgentTokenService],
    }).compile();
    service = moduleRef.get(AgentTokenService);
  });

  afterAll(async () => {
    await mongod.stop();
  });

  it('status reports no token before rotate is ever called', async () => {
    const userId = new Types.ObjectId().toHexString();
    const status = await service.status(userId);
    expect(status).toEqual({ hasToken: false, createdAt: null, lastUsedAt: null });
  });

  it('rotate creates a plaintext token resolvable via resolve()', async () => {
    const userId = new Types.ObjectId().toHexString();
    const token = await service.rotate(userId);
    expect(typeof token).toBe('string');
    expect(token.startsWith('ftk_')).toBe(true);

    const resolved = await service.resolve(token);
    expect(resolved).toEqual({ userId });

    const status = await service.status(userId);
    expect(status.hasToken).toBe(true);
    expect(status.createdAt).not.toBeNull();
  });

  it('rotating again invalidates the previous token', async () => {
    const userId = new Types.ObjectId().toHexString();
    const first = await service.rotate(userId);
    const second = await service.rotate(userId);
    expect(second).not.toBe(first);
    expect(await service.resolve(first)).toBeNull();
    expect(await service.resolve(second)).toEqual({ userId });
  });

  it('resolve returns null for an unknown token', async () => {
    expect(await service.resolve('ftk_does-not-exist')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/agent/agent-token.service.spec.ts --workspace server`
Expected: FAIL — `Cannot find module './agent-token.service'`

- [ ] **Step 4: Write the implementation**

```typescript
// server/src/agent/agent-token.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { AgentTokenStatusDto } from '@finance/shared';
import { ApiToken } from '../database/schemas/api-token.schema';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AgentTokenService {
  constructor(
    @InjectModel(ApiToken.name) private model: Model<ApiToken>,
  ) {}

  async rotate(userId: string): Promise<string> {
    const token = `ftk_${randomBytes(32).toString('base64url')}`;
    await this.model.updateOne(
      { userId: new Types.ObjectId(userId) },
      {
        tokenHash: hashToken(token),
        createdAt: new Date(),
        $unset: { lastUsedAt: '' },
      },
      { upsert: true },
    );
    return token;
  }

  async status(userId: string): Promise<AgentTokenStatusDto> {
    const doc = await this.model.findOne({ userId: new Types.ObjectId(userId) });
    if (!doc) return { hasToken: false, createdAt: null, lastUsedAt: null };
    return {
      hasToken: true,
      createdAt: doc.createdAt.toISOString(),
      lastUsedAt: doc.lastUsedAt?.toISOString() ?? null,
    };
  }

  async resolve(token: string): Promise<{ userId: string } | null> {
    const doc = await this.model.findOneAndUpdate(
      { tokenHash: hashToken(token) },
      { lastUsedAt: new Date() },
    );
    if (!doc) return null;
    return { userId: doc.userId.toHexString() };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/agent/agent-token.service.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add shared/src/index.ts server/src/agent/agent-token.service.ts server/src/agent/agent-token.service.spec.ts
git commit -m "feat: add AgentTokenService for bearer token rotate/status/resolve"
```

---

### Task 4: `BearerAuthGuard`

**Files:**
- Create: `server/src/agent/bearer-auth.guard.ts`
- Test: `server/src/agent/bearer-auth.guard.spec.ts`

**Interfaces:**
- Consumes: `AgentTokenService.resolve(token: string): Promise<{ userId: string } | null>` (Task 3).
- Produces: `BearerAuthGuard` (CanActivate). On success attaches `req.user = { userId: string }` (a distinct, smaller shape than the cookie guard's `AuthenticatedUser` — the MCP controller only ever needs `userId`). Exported `AgentUser` interface: `{ userId: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/agent/bearer-auth.guard.spec.ts
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { BearerAuthGuard } from './bearer-auth.guard';
import { AgentTokenService } from './agent-token.service';

function contextWithHeader(header?: string): ExecutionContext {
  const req: { headers: Record<string, string>; user?: unknown } = { headers: {} };
  if (header !== undefined) req.headers.authorization = header;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('BearerAuthGuard', () => {
  it('rejects a missing Authorization header', async () => {
    const guard = new BearerAuthGuard({ resolve: jest.fn() } as unknown as AgentTokenService);
    await expect(guard.canActivate(contextWithHeader(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a header without the Bearer scheme', async () => {
    const guard = new BearerAuthGuard({ resolve: jest.fn() } as unknown as AgentTokenService);
    await expect(guard.canActivate(contextWithHeader('Basic abc'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an unresolvable token', async () => {
    const resolve = jest.fn().mockResolvedValue(null);
    const guard = new BearerAuthGuard({ resolve } as unknown as AgentTokenService);
    await expect(
      guard.canActivate(contextWithHeader('Bearer ftk_bad')),
    ).rejects.toThrow(UnauthorizedException);
    expect(resolve).toHaveBeenCalledWith('ftk_bad');
  });

  it('attaches req.user on a valid token', async () => {
    const resolve = jest.fn().mockResolvedValue({ userId: 'user-1' });
    const guard = new BearerAuthGuard({ resolve } as unknown as AgentTokenService);
    const ctx = contextWithHeader('Bearer ftk_good');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const req = ctx.switchToHttp().getRequest() as { user?: { userId: string } };
    expect(req.user).toEqual({ userId: 'user-1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/agent/bearer-auth.guard.spec.ts --workspace server`
Expected: FAIL — `Cannot find module './bearer-auth.guard'`

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/agent/bearer-auth.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AgentTokenService } from './agent-token.service';

export interface AgentUser {
  userId: string;
}

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(private tokens: AgentTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedException();
    const resolved = await this.tokens.resolve(token);
    if (!resolved) throw new UnauthorizedException();
    (req as Request & { user: AgentUser }).user = resolved;
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/agent/bearer-auth.guard.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/agent/bearer-auth.guard.ts server/src/agent/bearer-auth.guard.spec.ts
git commit -m "feat: add BearerAuthGuard for agent MCP token auth"
```

---

### Task 5: Audit `actor` tagging + `TransactionsService` passthrough

**Files:**
- Modify: `server/src/audit/audit.service.ts`
- Modify: `server/src/database/schemas/audit-log.schema.ts`
- Modify: `server/src/transactions/transactions.service.ts`
- Test: `server/src/transactions/transactions.service.spec.ts` (create if it doesn't exist, otherwise extend)

**Interfaces:**
- Produces: `AuditEntry.actor?: 'user' | 'agent'` (defaults to `'user'` when omitted), `TransactionsService.create(userId, dto, actor?: 'user' | 'agent')` — `actor` defaults to `'user'`.

- [ ] **Step 1: Check for an existing transactions service unit test**

Run: `ls server/src/transactions/*.spec.ts`

If `transactions.service.spec.ts` doesn't exist, it will be created in Step 2 with a minimal harness. If it exists, add the new test case shown in Step 2 to it instead of replacing the file.

- [ ] **Step 2: Write the failing test**

```typescript
// server/src/transactions/transactions.service.spec.ts (new file, or add this test to the existing one)
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { Transaction, TransactionSchema } from '../database/schemas/transaction.schema';
import { BankAccount, BankAccountSchema } from '../database/schemas/bank-account.schema';
import { Commitment, CommitmentSchema } from '../database/schemas/commitment.schema';
import { Loan, LoanSchema } from '../database/schemas/loan.schema';
import { CreditCard, CreditCardSchema } from '../database/schemas/credit-card.schema';
import { AuditLog, AuditLogSchema } from '../database/schemas/audit-log.schema';
import { AuditLogService } from '../audit/audit.service';
import { BankAccountsService } from '../accounts/bank-accounts.service';
import { CommitmentsService } from '../commitments/commitments.service';
import { LoansService } from '../loans/loans.service';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { TransactionsService } from './transactions.service';

describe('TransactionsService actor tagging', () => {
  let mongod: MongoMemoryReplSet;
  let service: TransactionsService;
  let auditModel: import('mongoose').Model<AuditLog>;
  let userId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri('txn-actor-test')),
        MongooseModule.forFeature([
          { name: Transaction.name, schema: TransactionSchema },
          { name: BankAccount.name, schema: BankAccountSchema },
          { name: Commitment.name, schema: CommitmentSchema },
          { name: Loan.name, schema: LoanSchema },
          { name: CreditCard.name, schema: CreditCardSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
        ]),
      ],
      providers: [
        TransactionsService,
        AuditLogService,
        BankAccountsService,
        CommitmentsService,
        LoansService,
        CreditCardsService,
      ],
    }).compile();
    service = moduleRef.get(TransactionsService);
    auditModel = moduleRef.get(getModelToken(AuditLog.name));
    const bankModel = moduleRef.get(getModelToken(BankAccount.name));
    userId = new Types.ObjectId().toHexString();
    const account = await bankModel.create({
      userId: new Types.ObjectId(userId),
      name: 'Main',
      openingBalance: 100000,
      currentBalance: 100000,
      createdAt: new Date(),
    });
    bankAccountId = account._id.toHexString();
  });

  afterAll(async () => {
    await mongod.stop();
  });

  it('defaults the audit entry actor to "user" when not specified', async () => {
    await service.create(userId, {
      type: 'income',
      amount: 1000,
      date: new Date().toISOString(),
      sourceType: 'bankAccount',
      sourceId: bankAccountId,
    });
    const entry = await auditModel.findOne({ action: 'transaction.created' }).sort({
      _id: -1,
    });
    expect(entry?.actor).toBe('user');
  });

  it('tags the audit entry actor "agent" when passed explicitly', async () => {
    await service.create(
      userId,
      {
        type: 'income',
        amount: 2000,
        date: new Date().toISOString(),
        sourceType: 'bankAccount',
        sourceId: bankAccountId,
      },
      'agent',
    );
    const entry = await auditModel.findOne({ action: 'transaction.created' }).sort({
      _id: -1,
    });
    expect(entry?.actor).toBe('agent');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/transactions/transactions.service.spec.ts --workspace server`
Expected: FAIL — `TransactionsService.create` doesn't accept a third argument / `entry?.actor` is `undefined`.

- [ ] **Step 4: Add `actor` to the audit schema and entry type**

In `server/src/database/schemas/audit-log.schema.ts`, add after the `metadata` prop:

```typescript
  @Prop({ enum: ['user', 'agent'], default: 'user' })
  actor: 'user' | 'agent';
```

In `server/src/audit/audit.service.ts`, update `AuditEntry`:

```typescript
export interface AuditEntry {
  userId: string | Types.ObjectId;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  actor?: 'user' | 'agent';
}
```

`AuditLogService.log()` needs no change — the schema's `default: 'user'` already applies when `actor` is omitted from `entry`.

- [ ] **Step 5: Thread `actor` through `TransactionsService.create`**

In `server/src/transactions/transactions.service.ts`, change the `create` signature and its audit call:

```typescript
  async create(
    userId: string,
    dto: CreateTransactionDto,
    actor: 'user' | 'agent' = 'user',
  ): Promise<TransactionDto> {
```

and in the `await this.audit.log({...})` call inside `create`, add `actor,` to the object passed.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest src/transactions/transactions.service.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 7: Run the full server test suite**

Run: `npm test --workspace server`
Expected: PASS (confirms `TransactionsController.create`'s existing 2-arg call to `service.create` still compiles, since `actor` is optional).

- [ ] **Step 8: Commit**

```bash
git add server/src/audit/audit.service.ts server/src/database/schemas/audit-log.schema.ts server/src/transactions/transactions.service.ts server/src/transactions/transactions.service.spec.ts
git commit -m "feat: tag audit entries with actor, thread through TransactionsService.create"
```

---

### Task 6: `AgentTokenController` + `AgentModule` (status/rotate REST routes)

**Files:**
- Create: `server/src/agent/agent-token.controller.ts`
- Create: `server/src/agent/agent.module.ts`
- Modify: `server/src/app.module.ts`
- Test: `server/test/agent-token.e2e.spec.ts`

**Interfaces:**
- Consumes: `AgentTokenService` (Task 3), `AuthGuard`/`CurrentUser`/`AuthenticatedUser` (existing cookie-session auth).
- Produces: `GET /api/agent-token/status` → `AgentTokenStatusDto`; `POST /api/agent-token/rotate` → `{ token: string }`.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// server/test/agent-token.e2e.spec.ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('agent token status/rotate', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'agent-token@user.com'));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('rejects unauthenticated requests', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).get('/api/agent-token/status').expect(401);
    await request(server).post('/api/agent-token/rotate').expect(401);
  });

  it('reports no token before any rotate', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/agent-token/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toEqual({ hasToken: false, createdAt: null, lastUsedAt: null });
  });

  it('rotate returns a plaintext token once, then status reflects it', async () => {
    const server = ctx.app.getHttpServer();
    const rotateRes = await request(server)
      .post('/api/agent-token/rotate')
      .set('Cookie', cookie)
      .expect(201);
    expect(rotateRes.body.token).toMatch(/^ftk_/);

    const statusRes = await request(server)
      .get('/api/agent-token/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(statusRes.body.hasToken).toBe(true);
    expect(statusRes.body.token).toBeUndefined();
  });

  it('rotating again invalidates the previous token for MCP auth', async () => {
    const server = ctx.app.getHttpServer();
    const first = (
      await request(server).post('/api/agent-token/rotate').set('Cookie', cookie)
    ).body.token;
    const second = (
      await request(server).post('/api/agent-token/rotate').set('Cookie', cookie)
    ).body.token;
    expect(second).not.toBe(first);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/agent-token.e2e.spec.ts --workspace server`
Expected: FAIL — 404s, since no `/api/agent-token/*` routes exist yet.

- [ ] **Step 3: Write the controller**

```typescript
// server/src/agent/agent-token.controller.ts
import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth-guard/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth-guard/session.service';
import { AgentTokenService } from './agent-token.service';

@Controller('agent-token')
@UseGuards(AuthGuard)
export class AgentTokenController {
  constructor(private tokens: AgentTokenService) {}

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.tokens.status(user.userId);
  }

  @Post('rotate')
  @HttpCode(201)
  async rotate(@CurrentUser() user: AuthenticatedUser) {
    const token = await this.tokens.rotate(user.userId);
    return { token };
  }
}
```

- [ ] **Step 4: Write the module**

```typescript
// server/src/agent/agent.module.ts
import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { AgentTokenService } from './agent-token.service';
import { AgentTokenController } from './agent-token.controller';
import { BearerAuthGuard } from './bearer-auth.guard';

@Module({
  imports: [AuthGuardModule],
  controllers: [AgentTokenController],
  providers: [AgentTokenService, BearerAuthGuard],
  exports: [AgentTokenService, BearerAuthGuard],
})
export class AgentModule {}
```

- [ ] **Step 5: Register `AgentModule` in `AppModule`**

In `server/src/app.module.ts`, add the import:

```typescript
import { AgentModule } from './agent/agent.module';
```

and add `AgentModule` to the `imports` array (after `DashboardModule`).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest test/agent-token.e2e.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 7: Run the full server test suite**

Run: `npm test --workspace server`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/src/agent/agent-token.controller.ts server/src/agent/agent.module.ts server/src/app.module.ts server/test/agent-token.e2e.spec.ts
git commit -m "feat: add agent-token status/rotate REST routes"
```

---

### Task 7: `McpToolsService` (tool handlers)

**Files:**
- Create: `server/src/agent/mcp-tools.service.ts`
- Test: `server/src/agent/mcp-tools.service.spec.ts`

**Interfaces:**
- Consumes: `TransactionsService.create/list` (Task 5 + existing), `DashboardService.computeSummary/upcomingBills` (existing), `BankAccountsService.list`, `CommitmentsService.list`, `LoansService.list`, `CreditCardsService.list` (existing).
- Produces: `McpToolsService.createTransaction(userId, args): Promise<TransactionDto>`, `McpToolsService.getSummary(userId): Promise<{ summary: DashboardSummary; upcomingBills: UpcomingBill[] }>`, `McpToolsService.listTransactions(userId, args): Promise<Paginated<TransactionDto>>`, `McpToolsService.listAccounts(userId): Promise<{ bankAccounts: BankAccountDto[]; commitments: CommitmentDto[]; loans: LoanDto[]; creditCards: CreditCardDto[] }>`. These are plain async methods (not yet wired to the MCP SDK — that's Task 8), so they're independently unit-testable.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/agent/mcp-tools.service.spec.ts
import { McpToolsService } from './mcp-tools.service';

describe('McpToolsService', () => {
  function makeService(overrides: {
    txnCreate?: jest.Mock;
    txnList?: jest.Mock;
    computeSummary?: jest.Mock;
    upcomingBills?: jest.Mock;
    bankList?: jest.Mock;
    commitmentList?: jest.Mock;
    loanList?: jest.Mock;
    cardList?: jest.Mock;
  }) {
    const transactions = { create: overrides.txnCreate ?? jest.fn(), list: overrides.txnList ?? jest.fn() };
    const dashboard = {
      computeSummary: overrides.computeSummary ?? jest.fn(),
      upcomingBills: overrides.upcomingBills ?? jest.fn(),
    };
    const bankAccounts = { list: overrides.bankList ?? jest.fn() };
    const commitments = { list: overrides.commitmentList ?? jest.fn() };
    const loans = { list: overrides.loanList ?? jest.fn() };
    const cards = { list: overrides.cardList ?? jest.fn() };
    const service = new McpToolsService(
      transactions as any,
      dashboard as any,
      bankAccounts as any,
      commitments as any,
      loans as any,
      cards as any,
    );
    return { service, transactions, dashboard, bankAccounts, commitments, loans, cards };
  }

  it('createTransaction delegates to TransactionsService.create with actor "agent"', async () => {
    const txnCreate = jest.fn().mockResolvedValue({ id: 't1' });
    const { service } = makeService({ txnCreate });
    const args = {
      type: 'income' as const,
      amount: 1000,
      date: '2026-07-20T00:00:00.000Z',
      sourceType: 'bankAccount' as const,
      sourceId: 'acc1',
    };
    const result = await service.createTransaction('user1', args);
    expect(txnCreate).toHaveBeenCalledWith('user1', args, 'agent');
    expect(result).toEqual({ id: 't1' });
  });

  it('getSummary combines computeSummary and a 14-day upcomingBills window', async () => {
    const computeSummary = jest.fn().mockResolvedValue({ netWorth: 500 });
    const upcomingBills = jest.fn().mockResolvedValue([{ name: 'Rent' }]);
    const { service } = makeService({ computeSummary, upcomingBills });
    const result = await service.getSummary('user1');
    expect(computeSummary).toHaveBeenCalledWith('user1');
    expect(upcomingBills).toHaveBeenCalledWith('user1', 14);
    expect(result).toEqual({
      summary: { netWorth: 500 },
      upcomingBills: [{ name: 'Rent' }],
    });
  });

  it('listTransactions delegates to TransactionsService.list', async () => {
    const txnList = jest.fn().mockResolvedValue({ items: [], total: 0 });
    const { service } = makeService({ txnList });
    const args = { page: '1', pageSize: '20' };
    const result = await service.listTransactions('user1', args);
    expect(txnList).toHaveBeenCalledWith('user1', args);
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('listAccounts aggregates all four entity lists', async () => {
    const bankList = jest.fn().mockResolvedValue([{ id: 'b1' }]);
    const commitmentList = jest.fn().mockResolvedValue([{ id: 'c1' }]);
    const loanList = jest.fn().mockResolvedValue([{ id: 'l1' }]);
    const cardList = jest.fn().mockResolvedValue([{ id: 'cc1' }]);
    const { service } = makeService({ bankList, commitmentList, loanList, cardList });
    const result = await service.listAccounts('user1');
    expect(result).toEqual({
      bankAccounts: [{ id: 'b1' }],
      commitments: [{ id: 'c1' }],
      loans: [{ id: 'l1' }],
      creditCards: [{ id: 'cc1' }],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/agent/mcp-tools.service.spec.ts --workspace server`
Expected: FAIL — `Cannot find module './mcp-tools.service'`

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/agent/mcp-tools.service.ts
import { Injectable } from '@nestjs/common';
import {
  BankAccountDto,
  CommitmentDto,
  CreditCardDto,
  DashboardSummary,
  LoanDto,
  Paginated,
  TransactionDto,
  UpcomingBill,
} from '@finance/shared';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateTransactionDto, ListTransactionsQuery } from '../transactions/dto';
import { DashboardService } from '../dashboard/dashboard.service';
import { BankAccountsService } from '../accounts/bank-accounts.service';
import { CommitmentsService } from '../commitments/commitments.service';
import { LoansService } from '../loans/loans.service';
import { CreditCardsService } from '../credit-cards/credit-cards.service';

export interface SummaryResult {
  summary: DashboardSummary;
  upcomingBills: UpcomingBill[];
}

export interface AccountsResult {
  bankAccounts: BankAccountDto[];
  commitments: CommitmentDto[];
  loans: LoanDto[];
  creditCards: CreditCardDto[];
}

@Injectable()
export class McpToolsService {
  constructor(
    private transactions: TransactionsService,
    private dashboard: DashboardService,
    private bankAccounts: BankAccountsService,
    private commitments: CommitmentsService,
    private loans: LoansService,
    private cards: CreditCardsService,
  ) {}

  createTransaction(
    userId: string,
    args: CreateTransactionDto,
  ): Promise<TransactionDto> {
    return this.transactions.create(userId, args, 'agent');
  }

  async getSummary(userId: string): Promise<SummaryResult> {
    const [summary, upcomingBills] = await Promise.all([
      this.dashboard.computeSummary(userId),
      this.dashboard.upcomingBills(userId, 14),
    ]);
    return { summary, upcomingBills };
  }

  listTransactions(
    userId: string,
    args: ListTransactionsQuery,
  ): Promise<Paginated<TransactionDto>> {
    return this.transactions.list(userId, args);
  }

  async listAccounts(userId: string): Promise<AccountsResult> {
    const [bankAccounts, commitments, loans, creditCards] = await Promise.all([
      this.bankAccounts.list(userId),
      this.commitments.list(userId),
      this.loans.list(userId),
      this.cards.list(userId),
    ]);
    return { bankAccounts, commitments, loans, creditCards };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/agent/mcp-tools.service.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/agent/mcp-tools.service.ts server/src/agent/mcp-tools.service.spec.ts
git commit -m "feat: add McpToolsService wrapping domain services for MCP tools"
```

---

### Task 8: `McpController` (stateless Streamable HTTP endpoint) + wiring

**Files:**
- Create: `server/src/agent/mcp.controller.ts`
- Modify: `server/src/agent/agent.module.ts`
- Modify: `server/src/transactions/transactions.module.ts` (export needed for `AgentModule` to use `TransactionsService`, `DashboardService`, etc. — see Step 3)
- Test: `server/test/mcp.e2e.spec.ts`

**Interfaces:**
- Consumes: `BearerAuthGuard` (Task 4), `McpToolsService` (Task 7), `AgentUser` (Task 4).
- Produces: `POST /api/mcp` — a stateless MCP Streamable HTTP JSON-RPC endpoint implementing `initialize`, `tools/list`, `tools/call` for the four v1 tools.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// server/test/mcp.e2e.spec.ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

async function rpc(server: unknown, token: string, body: Record<string, unknown>) {
  return request(server as never)
    .post('/api/mcp')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .send(body);
}

// Each HTTP POST spins up a brand-new stateless MCP server (see mcp.controller.ts),
// so every request needs its own initialize handshake first, not just the first one.
async function initialize(server: unknown, token: string) {
  await rpc(server, token, {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
}

describe('MCP endpoint', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let token: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'mcp@user.com'));
    const server = ctx.app.getHttpServer();
    const rotateRes = await request(server)
      .post('/api/agent-token/rotate')
      .set('Cookie', cookie);
    token = rotateRes.body.token;
    const accountRes = await request(server)
      .post('/api/accounts/bank')
      .set('Cookie', cookie)
      .send({ name: 'Main', openingBalance: 500000 });
    bankAccountId = accountRes.body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('rejects requests without a valid bearer token', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);
  });

  it('lists the four v1 tools', async () => {
    const server = ctx.app.getHttpServer();
    await initialize(server, token);
    const res = await rpc(server, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = res.body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      'create_transaction',
      'get_summary',
      'list_accounts',
      'list_transactions',
    ]);
  });

  it('creates a transaction via tools/call and reflects it as an agent-tagged audit entry', async () => {
    const server = ctx.app.getHttpServer();
    await initialize(server, token);
    await rpc(server, token, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'create_transaction',
        arguments: {
          type: 'expense',
          amount: 2500,
          date: '2026-07-20T00:00:00.000Z',
          category: 'Food',
          sourceType: 'bankAccount',
          sourceId: bankAccountId,
        },
      },
    });

    const bank = await request(server)
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    expect(bank.body[0].currentBalance).toBe(500000 - 2500);

    const audit = await request(server)
      .get('/api/audit-log?page=1&pageSize=5')
      .set('Cookie', cookie);
    expect(audit.body.items[0].action).toBe('transaction.created');
  });

  it('stops accepting the old token after rotate', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).post('/api/agent-token/rotate').set('Cookie', cookie);
    await rpc(server, token, { jsonrpc: '2.0', id: 4, method: 'tools/list' }).expect(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/mcp.e2e.spec.ts --workspace server`
Expected: FAIL — 404 on `/api/mcp`.

- [ ] **Step 3: Make `TransactionsService`, `DashboardService`, and the entity list services importable by `AgentModule`**

`server/src/agent/agent.module.ts` needs `TransactionsService`, `DashboardService`, `BankAccountsService`, `CommitmentsService`, `LoansService`, `CreditCardsService`. `TransactionsModule` already exports `TransactionsService` and imports `AccountsModule`/`CommitmentsModule`/`LoansModule`/`CreditCardsModule` (which export their respective services). `DashboardModule` exports `DashboardService`. So `AgentModule` just needs to import `TransactionsModule`, `DashboardModule`, `AccountsModule`, `CommitmentsModule`, `LoansModule`, `CreditCardsModule` — no changes needed to any of those modules' own exports.

- [ ] **Step 4: Write the MCP controller**

```typescript
// server/src/agent/mcp.controller.ts
import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { EXPENSE_CATEGORIES } from '@finance/shared';
import { BearerAuthGuard, AgentUser } from './bearer-auth.guard';
import { McpToolsService } from './mcp-tools.service';

const TRANSACTION_TYPES = [
  'income',
  'expense',
  'commitmentPayment',
  'loanPayment',
  'cardPayment',
  'transfer',
] as const;

const SOURCE_TYPES = ['bankAccount', 'creditCard'] as const;

function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function toolResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

@Controller('mcp')
@UseGuards(BearerAuthGuard)
export class McpController {
  constructor(private tools: McpToolsService) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { userId } = (req as Request & { user: AgentUser }).user;
    const server = new McpServer({ name: 'finance-tracker', version: '1.0.0' });

    server.registerTool(
      'create_transaction',
      {
        description: 'Record a new transaction (income, expense, transfer, or a payment against a commitment/loan/credit card).',
        inputSchema: {
          type: z.enum(TRANSACTION_TYPES),
          amount: z.number().int().min(1).describe('Integer sen, e.g. RM 12.34 = 1234'),
          date: z.string().describe('ISO 8601 date string'),
          category: z.enum(EXPENSE_CATEGORIES).optional().describe('Required when type is "expense"'),
          sourceType: z.enum(SOURCE_TYPES),
          sourceId: z.string().describe('Bank account or credit card id'),
          toAccountId: z.string().optional().describe('Required when type is "transfer"'),
          linkedEntityId: z.string().optional().describe('Required for commitmentPayment/loanPayment/cardPayment'),
          note: z.string().max(200).optional(),
        },
      },
      async (args) => {
        try {
          const result = await this.tools.createTransaction(userId, args);
          return toolResult(result);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : 'Failed to create transaction.');
        }
      },
    );

    server.registerTool(
      'get_summary',
      {
        description: 'Get a financial summary: account balances, assets/liabilities/net worth, and bills due in the next 14 days.',
        inputSchema: {},
      },
      async () => {
        const result = await this.tools.getSummary(userId);
        return toolResult(result);
      },
    );

    server.registerTool(
      'list_transactions',
      {
        description: 'List/search recent transactions, optionally filtered by type, category, account, or date range.',
        inputSchema: {
          type: z.enum(TRANSACTION_TYPES).optional(),
          category: z.enum(EXPENSE_CATEGORIES).optional(),
          sourceId: z.string().optional(),
          from: z.string().optional().describe('ISO 8601 date, inclusive lower bound'),
          to: z.string().optional().describe('ISO 8601 date, inclusive upper bound'),
          page: z.string().optional(),
          pageSize: z.string().optional(),
        },
      },
      async (args) => {
        try {
          const result = await this.tools.listTransactions(userId, args);
          return toolResult(result);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : 'Failed to list transactions.');
        }
      },
    );

    server.registerTool(
      'list_accounts',
      {
        description: 'List all bank accounts, commitments, loans, and credit cards with their current balances/due dates/limits.',
        inputSchema: {},
      },
      async () => {
        const result = await this.tools.listAccounts(userId);
        return toolResult(result);
      },
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
```

- [ ] **Step 5: Update `AgentModule` to import the needed modules and declare `McpController`**

```typescript
// server/src/agent/agent.module.ts
import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { LoansModule } from '../loans/loans.module';
import { CreditCardsModule } from '../credit-cards/credit-cards.module';
import { AgentTokenService } from './agent-token.service';
import { AgentTokenController } from './agent-token.controller';
import { BearerAuthGuard } from './bearer-auth.guard';
import { McpToolsService } from './mcp-tools.service';
import { McpController } from './mcp.controller';

@Module({
  imports: [
    AuthGuardModule,
    TransactionsModule,
    DashboardModule,
    AccountsModule,
    CommitmentsModule,
    LoansModule,
    CreditCardsModule,
  ],
  controllers: [AgentTokenController, McpController],
  providers: [AgentTokenService, BearerAuthGuard, McpToolsService],
  exports: [AgentTokenService, BearerAuthGuard],
})
export class AgentModule {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest test/mcp.e2e.spec.ts --workspace server`
Expected: PASS

- [ ] **Step 7: Run the full server test suite**

Run: `npm test --workspace server`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/src/agent/mcp.controller.ts server/src/agent/agent.module.ts server/test/mcp.e2e.spec.ts
git commit -m "feat: add stateless Streamable HTTP MCP endpoint with v1 tools"
```

---

### Task 9: `AgentPage` (Settings sub-page)

**Files:**
- Create: `client/src/pages/AgentPage.tsx`
- Create: `client/src/pages/AgentPage.spec.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `GET /agent-token/status` → `AgentTokenStatusDto`, `POST /agent-token/rotate` → `{ token: string }` (Task 6), `client/src/api.ts`'s `api<T>()` helper.

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/pages/AgentPage.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AgentPage from './AgentPage';
import { api } from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);

describe('AgentPage', () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  it('shows "no token yet" state and a Generate button', async () => {
    mockedApi.mockResolvedValueOnce({ hasToken: false, createdAt: null, lastUsedAt: null });
    render(<MemoryRouter><AgentPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no agent token/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /generate token/i })).toBeInTheDocument();
  });

  it('generating a token shows it once and the copy-paste command', async () => {
    mockedApi.mockResolvedValueOnce({ hasToken: false, createdAt: null, lastUsedAt: null });
    mockedApi.mockResolvedValueOnce({ token: 'ftk_abc123' });
    render(<MemoryRouter><AgentPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /generate token/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate token/i }));
    await waitFor(() => expect(screen.getByText(/ftk_abc123/)).toBeInTheDocument());
    expect(screen.getByText(/claude mcp add/)).toBeInTheDocument();
    expect(mockedApi).toHaveBeenCalledWith('/agent-token/rotate', { method: 'POST' });
  });

  it('shows Rotate (not Generate) when a token already exists', async () => {
    mockedApi.mockResolvedValueOnce({
      hasToken: true,
      createdAt: '2026-07-01T00:00:00.000Z',
      lastUsedAt: null,
    });
    render(<MemoryRouter><AgentPage /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /rotate token/i })).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/AgentPage.spec.tsx --workspace client`
Expected: FAIL — `Cannot find module './AgentPage'`

- [ ] **Step 3: Write the page**

```typescript
// client/src/pages/AgentPage.tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AgentTokenStatusDto } from '@finance/shared';
import { api, ApiError } from '../api';
import Button from '../components/Button';

const TOOLS = [
  { name: 'create_transaction', description: 'Record a new income/expense/transfer/payment.' },
  { name: 'get_summary', description: 'Balances, net worth, and bills due in the next 14 days.' },
  { name: 'list_transactions', description: 'Search recent transactions by type, category, account, or date range.' },
  { name: 'list_accounts', description: 'List bank accounts, commitments, loans, and credit cards.' },
];

export default function AgentPage() {
  const [status, setStatus] = useState<AgentTokenStatusDto | null>(null);
  const [freshToken, setFreshToken] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setStatus(await api<AgentTokenStatusDto>('/agent-token/status'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rotate() {
    setError('');
    try {
      const res = await api<{ token: string }>('/agent-token/rotate', { method: 'POST' });
      setFreshToken(res.token);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate a token.');
    }
  }

  const command = freshToken
    ? `claude mcp add --transport http finance-tracker ${window.location.origin}/api/mcp --header "Authorization: Bearer ${freshToken}"`
    : '';

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Agent access</h1>
        <Link to="/settings" className="text-xs text-accent hover:underline">
          Back to settings
        </Link>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          Bearer token
        </h2>
        {!status ? null : !status.hasToken ? (
          <div>
            <p className="mb-3 text-sm text-muted">No agent token has been generated yet.</p>
            <Button onClick={rotate}>Generate token</Button>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm text-muted">
              Token created {new Date(status.createdAt!).toLocaleString()}
              {status.lastUsedAt
                ? `, last used ${new Date(status.lastUsedAt).toLocaleString()}`
                : ', never used yet'}
              .
            </p>
            <Button onClick={rotate}>Rotate token</Button>
          </div>
        )}

        {freshToken && (
          <div className="mt-4 rounded-md border border-border bg-surface-raised p-3">
            <p className="mb-2 text-xs text-danger">
              This token won&apos;t be shown again — copy it now.
            </p>
            <code className="block break-all text-sm">{freshToken}</code>
          </div>
        )}
      </section>

      {command && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
            Connect Claude Code
          </h2>
          <pre className="overflow-x-auto rounded-md border border-border bg-surface-raised p-3 text-xs">
            {command}
          </pre>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          Available tools
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {TOOLS.map((t) => (
            <li key={t.name} className="px-4 py-3 text-sm">
              <span className="font-mono text-ink">{t.name}</span>{' '}
              <span className="text-muted">— {t.description}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/AgentPage.spec.tsx --workspace client`
Expected: PASS

- [ ] **Step 5: Add the route**

In `client/src/App.tsx`, add the import:

```typescript
import AgentPage from './pages/AgentPage';
```

and add a new route after the `/settings` route:

```typescript
          <Route
            path="/settings/agent"
            element={
              <ProtectedRoute>
                <Layout>
                  <AgentPage />
                </Layout>
              </ProtectedRoute>
            }
          />
```

- [ ] **Step 6: Link from `SettingsPage`**

In `client/src/pages/SettingsPage.tsx`, add the import:

```typescript
import { Link } from 'react-router-dom';
```

(already imported — reuse it) and add a new section before the "Recent activity" section:

```tsx
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          Agent access
        </h2>
        <Link
          to="/settings/agent"
          className="text-sm text-accent hover:underline"
        >
          Connect an AI agent via MCP →
        </Link>
      </section>
```

- [ ] **Step 7: Run the full client test suite**

Run: `npm test --workspace client`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/AgentPage.tsx client/src/pages/AgentPage.spec.tsx client/src/App.tsx client/src/pages/SettingsPage.tsx
git commit -m "feat: add Settings > Agent access page for MCP token setup"
```

---

### Task 10: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Build everything**

```bash
npm run build:shared && npm run build --workspace server && npm run build --workspace client
```
Expected: all three build with no errors.

- [ ] **Step 2: Start dev servers and drive the golden path in a browser**

```bash
npm run start:dev --workspace server
npm run dev --workspace client
```

Navigate to `/settings/agent`, generate a token, confirm the copy box and `claude mcp add` command render correctly, then rotate and confirm the displayed token changes and the "created"/"last used" metadata updates after a subsequent MCP call.

- [ ] **Step 3: End-to-end MCP smoke test with the real Claude Code CLI (optional but recommended)**

Run the `claude mcp add` command shown on the page (with the dev server's origin, e.g. `http://localhost:5173`), then from a Claude Code session ask it to call `get_summary` and `create_transaction` against the running dev instance. Confirm the created transaction and its `actor: 'agent'` audit entry appear in the Settings audit list and `/transactions` page.

- [ ] **Step 4: Run the full test suite one more time**

```bash
npm test --workspace server
npm test --workspace client
```
Expected: PASS
