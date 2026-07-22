# MCP OAuth Shim + Multi-Token Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude Desktop connect to the finance tracker's MCP endpoint via a minimal OAuth handshake that resolves to the existing bearer-token auth underneath, without any manual token pasting — and support multiple independently-labeled, revocable agent tokens per user so this doesn't clobber a manually-issued token.

**Architecture:** `ApiToken` moves from one-token-per-user (unique index, hash-only) to a per-user list (label, hash, source). A new `OauthModule` implements OAuth discovery metadata, stub dynamic client registration, a session-gated `/authorize` → frontend consent page → `/authorize/approve` flow that mints a token via the reworked `AgentTokenService`, and a PKCE-verified `/token` exchange that hands back that token as the OAuth `access_token`. No changes to `BearerAuthGuard`/`McpController` — the returned token is a normal MCP bearer token.

**Tech Stack:** NestJS (server), React + Vite (client), Mongoose/MongoDB, Jest + Supertest (server tests), Vitest + Testing Library (client tests). No new dependencies — PKCE uses Node's built-in `crypto`.

## Global Constraints

- Rebuild `shared` after every change to `shared/src/` (`npm run build:shared`) — `server`/`client` consume its `dist/` output, not `src/` directly.
- Follow the existing modular-by-domain server layout (`server/src/<domain>/`); new Mongoose schemas are registered in `server/src/database/database.module.ts`, not per-module.
- Use the Playwright MCP tools to drive the running dev app and screenshot new UI flows before considering the work done (`CLAUDE.md`'s "Testing new features" rule) — in addition to, not instead of, unit/e2e tests.
- Server tests (`npm test --workspace server`) cover both colocated `*.spec.ts` unit tests and `server/test/*.e2e.spec.ts` e2e specs under one Jest run; client tests are `npm test --workspace client` (Vitest).

---

### Task 1: Multi-token `ApiToken` schema + `AgentTokenService`

**Files:**
- Modify: `server/src/database/schemas/api-token.schema.ts`
- Modify: `server/src/agent/agent-token.service.ts`
- Modify: `server/src/agent/agent-token.service.spec.ts`
- Modify: `shared/src/index.ts:145-152` (replace `AgentTokenStatusDto` with `AgentTokenDto`)

**Interfaces:**
- Produces: `AgentTokenService.create(userId: string, label: string, source: 'manual' | 'oauth'): Promise<{ id: string; token: string }>`, `.list(userId: string): Promise<AgentTokenDto[]>`, `.revoke(userId: string, tokenId: string): Promise<void>` (throws `NotFoundException` if not owned/found), `.resolve(token: string): Promise<{ userId: string } | null>` (signature unchanged, now looks up across all of a user's tokens).
- Consumes: nothing from other tasks.

- [ ] **Step 1: Update the shared `AgentTokenDto` type**

Replace lines 145-152 of `shared/src/index.ts`:

```ts
// ---- Agent MCP endpoint DTOs ----

export type AgentTokenSource = 'manual' | 'oauth';

export interface AgentTokenDto {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  source: AgentTokenSource;
}
```

- [ ] **Step 2: Rebuild shared**

Run: `npm run build:shared`
Expected: builds cleanly, no TS errors from removing `AgentTokenStatusDto` yet (nothing consumes it until Task 3).

- [ ] **Step 3: Rewrite the failing test for the new service API**

Replace `server/src/agent/agent-token.service.spec.ts` in full:

```ts
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

  it('list is empty before any token is created', async () => {
    const userId = new Types.ObjectId().toHexString();
    expect(await service.list(userId)).toEqual([]);
  });

  it('create returns a plaintext token resolvable via resolve()', async () => {
    const userId = new Types.ObjectId().toHexString();
    const { id, token } = await service.create(userId, 'manual script', 'manual');
    expect(token.startsWith('ftk_')).toBe(true);

    expect(await service.resolve(token)).toEqual({ userId });

    const list = await service.list(userId);
    expect(list).toEqual([
      {
        id,
        label: 'manual script',
        createdAt: expect.any(String),
        lastUsedAt: null,
        source: 'manual',
      },
    ]);
  });

  it('creating a second token does not invalidate the first', async () => {
    const userId = new Types.ObjectId().toHexString();
    const first = await service.create(userId, 'first', 'manual');
    const second = await service.create(userId, 'second', 'oauth');

    expect(await service.resolve(first.token)).toEqual({ userId });
    expect(await service.resolve(second.token)).toEqual({ userId });
    expect((await service.list(userId)).map((t) => t.label).sort()).toEqual([
      'first',
      'second',
    ]);
  });

  it('revoke removes only the targeted token', async () => {
    const userId = new Types.ObjectId().toHexString();
    const first = await service.create(userId, 'keep', 'manual');
    const second = await service.create(userId, 'remove', 'manual');

    await service.revoke(userId, second.id);

    expect(await service.resolve(first.token)).toEqual({ userId });
    expect(await service.resolve(second.token)).toBeNull();
    expect((await service.list(userId)).map((t) => t.label)).toEqual(['keep']);
  });

  it('revoke throws for a token belonging to another user', async () => {
    const userId = new Types.ObjectId().toHexString();
    const otherUserId = new Types.ObjectId().toHexString();
    const { id } = await service.create(userId, 'mine', 'manual');

    await expect(service.revoke(otherUserId, id)).rejects.toThrow();
    expect(await service.list(userId)).toHaveLength(1);
  });

  it('resolve returns null for an unknown token', async () => {
    expect(await service.resolve('ftk_does-not-exist')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx jest src/agent/agent-token.service.spec.ts --workspace server`
Expected: FAIL — `service.create`/`service.list`/`service.revoke` don't exist yet (old service only has `rotate`/`status`).

- [ ] **Step 5: Rewrite the schema**

Replace `server/src/database/schemas/api-token.schema.ts` in full:

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ApiTokenDocument = HydratedDocument<ApiToken>;
export type ApiTokenSource = 'manual' | 'oauth';

@Schema()
export class ApiToken {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  label: string;

  @Prop({ required: true, index: true })
  tokenHash: string;

  @Prop({ required: true })
  createdAt: Date;

  @Prop()
  lastUsedAt?: Date;

  @Prop({ required: true, enum: ['manual', 'oauth'] })
  source: ApiTokenSource;
}

export const ApiTokenSchema = SchemaFactory.createForClass(ApiToken);
```

- [ ] **Step 6: Rewrite `AgentTokenService`**

Replace `server/src/agent/agent-token.service.ts` in full:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { AgentTokenDto } from '@finance/shared';
import { ApiToken, ApiTokenSource } from '../database/schemas/api-token.schema';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AgentTokenService {
  constructor(
    @InjectModel(ApiToken.name) private model: Model<ApiToken>,
  ) {}

  async create(
    userId: string,
    label: string,
    source: ApiTokenSource,
  ): Promise<{ id: string; token: string }> {
    const token = `ftk_${randomBytes(32).toString('base64url')}`;
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      label,
      tokenHash: hashToken(token),
      createdAt: new Date(),
      source,
    });
    return { id: doc._id.toHexString(), token };
  }

  async list(userId: string): Promise<AgentTokenDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 });
    return docs.map((doc) => ({
      id: doc._id.toHexString(),
      label: doc.label,
      createdAt: doc.createdAt.toISOString(),
      lastUsedAt: doc.lastUsedAt?.toISOString() ?? null,
      source: doc.source,
    }));
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    const res = await this.model.deleteOne({
      _id: new Types.ObjectId(tokenId),
      userId: new Types.ObjectId(userId),
    });
    if (res.deletedCount === 0) throw new NotFoundException();
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

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx jest src/agent/agent-token.service.spec.ts --workspace server`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add shared/src/index.ts server/src/database/schemas/api-token.schema.ts server/src/agent/agent-token.service.ts server/src/agent/agent-token.service.spec.ts
git commit -m "feat: rework ApiToken into a per-user list of labeled, revocable tokens"
```

---

### Task 2: `AgentTokenController` (list/create/revoke) + e2e rework

**Files:**
- Create: `server/src/agent/dto.ts`
- Modify: `server/src/agent/agent-token.controller.ts`
- Modify: `server/test/agent-token.e2e.spec.ts`
- Modify: `server/test/mcp.e2e.spec.ts`
- Modify: `client/src/pages/AgentPage.tsx` — **not this task**, deferred to Task 3 (frontend still calls the old `/agent-token/status` and `/agent-token/rotate` routes; this task will break the running client, which Task 3 fixes right after — acceptable within the same plan since Task 3 is next).

**Interfaces:**
- Consumes: `AgentTokenService` from Task 1 (`create`, `list`, `revoke`).
- Produces: `GET /agent-token/list` → `AgentTokenDto[]`; `POST /agent-token/create` body `{ label: string }` → `{ token: string }` (plaintext, once); `DELETE /agent-token/:id` → `204`.

- [ ] **Step 1: Write the failing e2e test**

Replace `server/test/agent-token.e2e.spec.ts` in full:

```ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('agent token list/create/revoke', () => {
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
    await request(server).get('/api/agent-token/list').expect(401);
    await request(server).post('/api/agent-token/create').send({ label: 'x' }).expect(401);
    await request(server)
      .delete('/api/agent-token/000000000000000000000000')
      .expect(401);
  });

  it('list is empty before any token is created', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/agent-token/list')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('create returns a plaintext token once, then list reflects it', async () => {
    const server = ctx.app.getHttpServer();
    const createRes = await request(server)
      .post('/api/agent-token/create')
      .set('Cookie', cookie)
      .send({ label: 'manual script' })
      .expect(201);
    expect(createRes.body.token).toMatch(/^ftk_/);

    const listRes = await request(server)
      .get('/api/agent-token/list')
      .set('Cookie', cookie)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0]).toMatchObject({ label: 'manual script', source: 'manual' });
    expect(listRes.body[0].token).toBeUndefined();
  });

  it('creating a second token does not invalidate the first', async () => {
    const server = ctx.app.getHttpServer();
    await request(server)
      .post('/api/agent-token/create')
      .set('Cookie', cookie)
      .send({ label: 'two' });
    const listRes = await request(server).get('/api/agent-token/list').set('Cookie', cookie);
    expect(listRes.body).toHaveLength(2);
  });

  it('revoke removes a token by id and leaves others intact', async () => {
    const server = ctx.app.getHttpServer();
    const listRes = await request(server).get('/api/agent-token/list').set('Cookie', cookie);
    const idToRemove = listRes.body[0].id as string;

    await request(server)
      .delete(`/api/agent-token/${idToRemove}`)
      .set('Cookie', cookie)
      .expect(204);

    const after = await request(server).get('/api/agent-token/list').set('Cookie', cookie);
    expect(after.body.map((t: { id: string }) => t.id)).not.toContain(idToRemove);
    expect(after.body).toHaveLength(1);
  });

  it('rejects a bearer token (no cookie) on cookie-guarded routes', async () => {
    const server = ctx.app.getHttpServer();
    const createRes = await request(server)
      .post('/api/agent-token/create')
      .set('Cookie', cookie)
      .send({ label: 'bearer-test' });
    const token = createRes.body.token;

    await request(server)
      .post('/api/agent-token/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'nope' })
      .expect(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest test/agent-token.e2e.spec.ts --workspace server`
Expected: FAIL — routes `/agent-token/list` and `/agent-token/create` don't exist yet (404).

- [ ] **Step 3: Add the create DTO**

Create `server/src/agent/dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAgentTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label: string;
}
```

- [ ] **Step 4: Rewrite the controller**

Replace `server/src/agent/agent-token.controller.ts` in full:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth-guard/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth-guard/session.service';
import { AgentTokenService } from './agent-token.service';
import { CreateAgentTokenDto } from './dto';

@Controller('agent-token')
@UseGuards(AuthGuard)
export class AgentTokenController {
  constructor(private tokens: AgentTokenService) {}

  @Get('list')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tokens.list(user.userId);
  }

  @Post('create')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateAgentTokenDto,
  ) {
    const { token } = await this.tokens.create(user.userId, body.label, 'manual');
    return { token };
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.tokens.revoke(user.userId, id);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest test/agent-token.e2e.spec.ts --workspace server`
Expected: PASS (6 tests).

- [ ] **Step 6: Fix `mcp.e2e.spec.ts`, which currently calls the removed `/agent-token/rotate` route**

In `server/test/mcp.e2e.spec.ts`, replace the token-setup line in `beforeAll` (around line 43-46):

```ts
    const rotateRes = await request(server)
      .post('/api/agent-token/rotate')
      .set('Cookie', cookie);
    token = rotateRes.body.token;
```

with:

```ts
    const createRes = await request(server)
      .post('/api/agent-token/create')
      .set('Cookie', cookie)
      .send({ label: 'test agent' });
    token = createRes.body.token;
```

And replace the final test (around line 111-115), which asserted rotate invalidates the old token — that behavior no longer applies since creating a second token doesn't touch the first. Replace it with a revoke-based equivalent:

```ts
  it('stops accepting a token after it is revoked', async () => {
    const server = ctx.app.getHttpServer();
    const listRes = await request(server)
      .get('/api/agent-token/list')
      .set('Cookie', cookie);
    const tokenId = listRes.body.find(
      (t: { label: string }) => t.label === 'test agent',
    ).id;

    await request(server)
      .delete(`/api/agent-token/${tokenId}`)
      .set('Cookie', cookie);

    await rpc(server, token, { jsonrpc: '2.0', id: 4, method: 'tools/list' }).expect(401);
  });
```

- [ ] **Step 7: Run the full server test suite to confirm nothing else broke**

Run: `npm test --workspace server`
Expected: PASS — all suites green, including the updated `mcp.e2e.spec.ts`.

- [ ] **Step 8: Commit**

```bash
git add server/src/agent/dto.ts server/src/agent/agent-token.controller.ts server/test/agent-token.e2e.spec.ts server/test/mcp.e2e.spec.ts
git commit -m "feat: expose list/create/revoke routes for multi-token agent access"
```

---

### Task 3: Frontend — `AgentPage` token table

**Files:**
- Modify: `client/src/pages/AgentPage.tsx`
- Modify: `client/src/pages/AgentPage.spec.tsx`

**Interfaces:**
- Consumes: `GET /agent-token/list` → `AgentTokenDto[]`, `POST /agent-token/create` body `{ label: string }` → `{ token: string }`, `DELETE /agent-token/:id` (all from Task 2); `AgentTokenDto` type from `@finance/shared` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Replace `client/src/pages/AgentPage.spec.tsx` in full:

```tsx
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

  it('shows "no tokens yet" state', async () => {
    mockedApi.mockResolvedValueOnce([]);
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText(/no agent tokens/i)).toBeInTheDocument(),
    );
  });

  it('creating a token shows it once and the copy-paste command', async () => {
    mockedApi.mockResolvedValueOnce([]);
    mockedApi.mockResolvedValueOnce({ token: 'ftk_abc123' });
    mockedApi.mockResolvedValueOnce([
      {
        id: '1',
        label: 'manual token',
        createdAt: '2026-07-01T00:00:00.000Z',
        lastUsedAt: null,
        source: 'manual',
      },
    ]);
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByLabelText(/label/i));
    await userEvent.type(screen.getByLabelText(/label/i), 'manual token');
    await userEvent.click(screen.getByRole('button', { name: /create new token/i }));
    await waitFor(() => expect(screen.getByText(/ftk_abc123/)).toBeInTheDocument());
    expect(screen.getByText(/claude mcp add/)).toBeInTheDocument();
    expect(mockedApi).toHaveBeenCalledWith('/agent-token/create', {
      method: 'POST',
      body: { label: 'manual token' },
    });
  });

  it('lists existing tokens with a revoke button each', async () => {
    mockedApi.mockResolvedValueOnce([
      {
        id: '1',
        label: 'manual script',
        createdAt: '2026-07-01T00:00:00.000Z',
        lastUsedAt: null,
        source: 'manual',
      },
      {
        id: '2',
        label: 'Claude Desktop (OAuth)',
        createdAt: '2026-07-02T00:00:00.000Z',
        lastUsedAt: null,
        source: 'oauth',
      },
    ]);
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('manual script')).toBeInTheDocument());
    expect(screen.getByText('Claude Desktop (OAuth)')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /revoke/i })).toHaveLength(2);
  });

  it('revoking a token calls the delete endpoint and reloads the list', async () => {
    mockedApi.mockResolvedValueOnce([
      {
        id: '1',
        label: 'manual script',
        createdAt: '2026-07-01T00:00:00.000Z',
        lastUsedAt: null,
        source: 'manual',
      },
    ]);
    mockedApi.mockResolvedValueOnce(undefined);
    mockedApi.mockResolvedValueOnce([]);
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByRole('button', { name: /revoke/i }));
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/agent-token/1', { method: 'DELETE' }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pages/AgentPage.spec.tsx --workspace client`
Expected: FAIL — current `AgentPage` renders a single status panel, not a token table, and calls `/agent-token/status`/`/agent-token/rotate`.

- [ ] **Step 3: Rewrite `AgentPage.tsx`**

Replace `client/src/pages/AgentPage.tsx` in full:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AgentTokenDto } from '@finance/shared';
import { api, ApiError } from '../api';
import Button from '../components/Button';
import IconButton from '../components/IconButton';
import Input from '../components/Input';
import { TrashIcon } from '../components/icons';

const TOOLS = [
  { name: 'create_transaction', description: 'Record a new income/expense/transfer/payment.' },
  { name: 'get_summary', description: 'Balances, net worth, and bills due in the next 14 days.' },
  { name: 'list_transactions', description: 'Search recent transactions by type, category, account, or date range.' },
  { name: 'list_accounts', description: 'List bank accounts, commitments, loans, and credit cards.' },
];

export default function AgentPage() {
  const [tokens, setTokens] = useState<AgentTokenDto[]>([]);
  const [label, setLabel] = useState('');
  const [freshToken, setFreshToken] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setTokens(await api<AgentTokenDto[]>('/agent-token/list'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setError('');
    try {
      const res = await api<{ token: string }>('/agent-token/create', {
        method: 'POST',
        body: { label },
      });
      setFreshToken(res.token);
      setLabel('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate a token.');
    }
  }

  async function revoke(id: string) {
    setError('');
    try {
      await api(`/agent-token/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke token.');
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
          Bearer tokens
        </h2>
        {tokens.length === 0 ? (
          <p className="mb-4 text-sm text-muted">No agent tokens have been created yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-border rounded-lg border border-border">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-3">
                <div className="text-sm text-ink">
                  {t.label}{' '}
                  <span className="text-muted">
                    — {t.source} · created {new Date(t.createdAt).toLocaleDateString()}
                    {t.lastUsedAt
                      ? `, last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                      : ', never used yet'}
                  </span>
                </div>
                <IconButton label="Revoke" variant="destructive" onClick={() => revoke(t.id)}>
                  <TrashIcon />
                </IconButton>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2">
          <Input
            id="token-label"
            label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. manual script"
          />
          <Button onClick={create} disabled={!label.trim()}>
            Create new token
          </Button>
        </div>

        {freshToken && (
          <div className="mt-4 rounded-md border border-border bg-surface-raised p-3">
            <p className="mb-2 text-xs text-danger">
              This token won&apos;t be shown again — copy it now.
            </p>
            <input
              aria-label="Generated agent token"
              readOnly
              value={freshToken}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full break-all rounded border border-border bg-transparent p-1.5 font-mono text-sm"
            />
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/pages/AgentPage.spec.tsx --workspace client`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full client test suite to confirm nothing else broke**

Run: `npm test --workspace client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/AgentPage.tsx client/src/pages/AgentPage.spec.tsx
git commit -m "feat: rework Agent access settings page into a multi-token table"
```

---

### Task 4: `OauthCodeStore` + PKCE verification

**Files:**
- Create: `server/src/oauth/oauth-code.store.ts`
- Create: `server/src/oauth/oauth-code.store.spec.ts`
- Create: `server/src/oauth/pkce.ts`
- Create: `server/src/oauth/pkce.spec.ts`

**Interfaces:**
- Produces: `OauthCodeStore.create(entry: OauthCodeEntry): string` (mints a single-use code), `.consume(code: string): OauthCodeEntry | null` (single-use, deletes on read, `null` if unknown/expired); `OauthCodeEntry { userId: string; token: string; redirectUri: string; codeChallenge: string; expiresAt: number }`; `verifyPkce(codeVerifier: string, codeChallenge: string): boolean` (S256).
- Consumes: nothing from other tasks — this is a standalone, in-memory building block Task 5 wires into `OauthController`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/oauth/pkce.spec.ts`:

```ts
import { createHash } from 'crypto';
import { verifyPkce } from './pkce';

describe('verifyPkce', () => {
  it('accepts a verifier whose S256 hash matches the challenge', () => {
    const verifier = 'a-random-code-verifier-string-1234567890';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it('rejects a verifier that does not match the challenge', () => {
    expect(verifyPkce('wrong-verifier', 'some-other-challenge')).toBe(false);
  });
});
```

Create `server/src/oauth/oauth-code.store.spec.ts`:

```ts
import { OauthCodeStore } from './oauth-code.store';

describe('OauthCodeStore', () => {
  it('consume returns the entry and deletes it (single use)', () => {
    const store = new OauthCodeStore();
    const code = store.create({
      userId: 'u1',
      token: 'ftk_x',
      redirectUri: 'http://127.0.0.1:1234/cb',
      codeChallenge: 'chal',
      expiresAt: Date.now() + 60_000,
    });

    expect(store.consume(code)).toMatchObject({ userId: 'u1', token: 'ftk_x' });
    expect(store.consume(code)).toBeNull();
  });

  it('consume returns null for an unknown code', () => {
    const store = new OauthCodeStore();
    expect(store.consume('does-not-exist')).toBeNull();
  });

  it('consume returns null for an expired code', () => {
    const store = new OauthCodeStore();
    const code = store.create({
      userId: 'u1',
      token: 'ftk_x',
      redirectUri: 'http://127.0.0.1:1234/cb',
      codeChallenge: 'chal',
      expiresAt: Date.now() - 1,
    });

    expect(store.consume(code)).toBeNull();
  });

  it('two independently created codes do not collide', () => {
    const store = new OauthCodeStore();
    const codeA = store.create({
      userId: 'a',
      token: 'ftk_a',
      redirectUri: 'http://127.0.0.1:1/cb',
      codeChallenge: 'ca',
      expiresAt: Date.now() + 60_000,
    });
    const codeB = store.create({
      userId: 'b',
      token: 'ftk_b',
      redirectUri: 'http://127.0.0.1:2/cb',
      codeChallenge: 'cb',
      expiresAt: Date.now() + 60_000,
    });

    expect(codeA).not.toBe(codeB);
    expect(store.consume(codeA)).toMatchObject({ userId: 'a' });
    expect(store.consume(codeB)).toMatchObject({ userId: 'b' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/oauth --workspace server`
Expected: FAIL — `./pkce` and `./oauth-code.store` don't exist yet.

- [ ] **Step 3: Implement `pkce.ts`**

Create `server/src/oauth/pkce.ts`:

```ts
import { createHash } from 'crypto';

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash('sha256').update(codeVerifier).digest('base64url');
  return computed === codeChallenge;
}
```

- [ ] **Step 4: Implement `oauth-code.store.ts`**

Create `server/src/oauth/oauth-code.store.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

export interface OauthCodeEntry {
  userId: string;
  token: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
}

@Injectable()
export class OauthCodeStore {
  private codes = new Map<string, OauthCodeEntry>();

  create(entry: OauthCodeEntry): string {
    this.sweep();
    const code = randomBytes(24).toString('base64url');
    this.codes.set(code, entry);
    return code;
  }

  consume(code: string): OauthCodeEntry | null {
    const entry = this.codes.get(code);
    this.codes.delete(code);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, entry] of this.codes) {
      if (entry.expiresAt < now) this.codes.delete(code);
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/oauth --workspace server`
Expected: PASS (6 tests across both files).

- [ ] **Step 6: Commit**

```bash
git add server/src/oauth/oauth-code.store.ts server/src/oauth/oauth-code.store.spec.ts server/src/oauth/pkce.ts server/src/oauth/pkce.spec.ts
git commit -m "feat: add in-memory OAuth code store and PKCE verification"
```

---

### Task 5: `OauthModule` — discovery, registration, authorize, token exchange

**Files:**
- Create: `server/src/oauth/dto.ts`
- Create: `server/src/oauth/oauth-metadata.controller.ts`
- Create: `server/src/oauth/oauth.controller.ts`
- Create: `server/src/oauth/oauth.module.ts`
- Create: `server/test/oauth.e2e.spec.ts`
- Modify: `server/src/app.module.ts` (register `OauthModule`)
- Modify: `server/src/main.ts` (exclude the well-known route from the global `api` prefix)
- Modify: `server/test/utils/app.ts` (mirror the same prefix exclusion)
- Modify: `client/nginx.conf` (proxy the well-known path to the server container — it currently only proxies `/api/`)
- Modify: `client/vite.config.ts` (proxy the well-known path in dev, mirroring `/api`)

**Interfaces:**
- Consumes: `AgentTokenService.create` (Task 1, exported by `AgentModule`), `OauthCodeStore`/`verifyPkce` (Task 4).
- Produces: `GET /.well-known/oauth-authorization-server` (unprefixed), `POST /api/oauth/register`, `GET /api/oauth/authorize`, `POST /api/oauth/authorize/approve` → `{ redirectUrl: string }` (consumed by Task 6's `OAuthConsentPage`), `POST /api/oauth/token` → `{ access_token: string; token_type: 'Bearer' }`.

- [ ] **Step 1: Write the failing e2e test**

Create `server/test/oauth.e2e.spec.ts`:

```ts
import request from 'supertest';
import { createHash, randomBytes } from 'crypto';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

describe('OAuth shim', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'oauth@user.com'));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('serves discovery metadata unprefixed, pointing at the /api endpoints', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/.well-known/oauth-authorization-server')
      .expect(200);
    expect(res.body.authorization_endpoint).toMatch(/\/api\/oauth\/authorize$/);
    expect(res.body.token_endpoint).toMatch(/\/api\/oauth\/token$/);
    expect(res.body.registration_endpoint).toMatch(/\/api\/oauth\/register$/);
  });

  it('register returns a client_id without requiring auth', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/oauth/register')
      .send({})
      .expect(201);
    expect(typeof res.body.client_id).toBe('string');
  });

  it('authorize redirects to the frontend consent page for a loopback redirect_uri', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/oauth/authorize')
      .query({
        client_id: 'abc',
        redirect_uri: 'http://127.0.0.1:54321/callback',
        state: 'xyz',
        code_challenge: 'chal',
        code_challenge_method: 'S256',
        response_type: 'code',
      })
      .expect(302);
    expect(res.headers.location).toContain('/oauth-consent?');
    expect(res.headers.location).toContain('redirect_uri=');
  });

  it('authorize rejects a non-loopback redirect_uri', async () => {
    await request(ctx.app.getHttpServer())
      .get('/api/oauth/authorize')
      .query({ redirect_uri: 'https://evil.example.com/callback' })
      .expect(400);
  });

  it('approve requires an authenticated session', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/oauth/authorize/approve')
      .send({
        redirectUri: 'http://127.0.0.1:54321/callback',
        codeChallenge: 'chal',
        codeChallengeMethod: 'S256',
      })
      .expect(401);
  });

  it('completes the full authorize -> approve -> token exchange, and the resulting access_token works against /api/mcp', async () => {
    const server = ctx.app.getHttpServer();
    const { verifier, challenge } = pkcePair();
    const redirectUri = 'http://127.0.0.1:54321/callback';

    const approveRes = await request(server)
      .post('/api/oauth/authorize/approve')
      .set('Cookie', cookie)
      .send({
        redirectUri,
        state: 'xyz',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      })
      .expect(201);

    const redirectUrl = new URL(approveRes.body.redirectUrl);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(redirectUri);
    expect(redirectUrl.searchParams.get('state')).toBe('xyz');
    const code = redirectUrl.searchParams.get('code');
    expect(code).toBeTruthy();

    const tokenRes = await request(server)
      .post('/api/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      })
      .expect(201);
    expect(tokenRes.body.token_type).toBe('Bearer');
    const accessToken = tokenRes.body.access_token as string;
    expect(accessToken).toMatch(/^ftk_/);

    await request(server)
      .post('/api/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'claude-desktop', version: '1.0.0' },
        },
      })
      .expect(200);

    const listRes = await request(server)
      .get('/api/agent-token/list')
      .set('Cookie', cookie);
    expect(
      listRes.body.some(
        (t: { label: string; source: string }) =>
          t.label === 'Claude Desktop (OAuth)' && t.source === 'oauth',
      ),
    ).toBe(true);
  });

  it('rejects reusing the same authorization code', async () => {
    const server = ctx.app.getHttpServer();
    const { verifier, challenge } = pkcePair();
    const redirectUri = 'http://127.0.0.1:1/cb';

    const approveRes = await request(server)
      .post('/api/oauth/authorize/approve')
      .set('Cookie', cookie)
      .send({ redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256' });
    const code = new URL(approveRes.body.redirectUrl).searchParams.get('code');

    const body = { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri };
    await request(server).post('/api/oauth/token').type('form').send(body).expect(201);
    const second = await request(server).post('/api/oauth/token').type('form').send(body).expect(400);
    expect(second.body.error).toBe('invalid_grant');
  });

  it('rejects a mismatched PKCE verifier', async () => {
    const server = ctx.app.getHttpServer();
    const { challenge } = pkcePair();
    const redirectUri = 'http://127.0.0.1:2/cb';

    const approveRes = await request(server)
      .post('/api/oauth/authorize/approve')
      .set('Cookie', cookie)
      .send({ redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256' });
    const code = new URL(approveRes.body.redirectUrl).searchParams.get('code');

    const res = await request(server)
      .post('/api/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'totally-wrong-verifier',
        redirect_uri: redirectUri,
      })
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest test/oauth.e2e.spec.ts --workspace server`
Expected: FAIL — none of the `/oauth/*` routes or `/.well-known/...` exist yet.

- [ ] **Step 3: Add the OAuth DTOs**

Create `server/src/oauth/dto.ts`:

```ts
import { IsIn, IsOptional, IsString } from 'class-validator';

export class ApproveAuthorizeDto {
  @IsString()
  redirectUri: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsString()
  codeChallenge: string;

  @IsIn(['S256'])
  codeChallengeMethod: string;
}

export class TokenExchangeDto {
  @IsIn(['authorization_code'])
  grant_type: string;

  @IsString()
  code: string;

  @IsString()
  code_verifier: string;

  @IsString()
  redirect_uri: string;
}
```

- [ ] **Step 4: Add the metadata controller**

Create `server/src/oauth/oauth-metadata.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('.well-known')
export class OauthMetadataController {
  constructor(private config: ConfigService) {}

  @Get('oauth-authorization-server')
  metadata() {
    const origin = this.config.get('WEBAUTHN_ORIGIN', 'http://localhost:5173');
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    };
  }
}
```

- [ ] **Step 5: Add the main OAuth controller**

Create `server/src/oauth/oauth.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AuthGuard } from '../auth-guard/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth-guard/session.service';
import { AgentTokenService } from '../agent/agent-token.service';
import { OauthCodeStore } from './oauth-code.store';
import { ApproveAuthorizeDto, TokenExchangeDto } from './dto';
import { verifyPkce } from './pkce';

const CODE_TTL_MS = 60_000;

function isLoopbackRedirect(redirectUri: string | undefined): boolean {
  if (!redirectUri) return false;
  try {
    const url = new URL(redirectUri);
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

@Controller('oauth')
export class OauthController {
  constructor(
    private tokens: AgentTokenService,
    private codes: OauthCodeStore,
    private config: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(201)
  register() {
    return {
      client_id: randomBytes(12).toString('hex'),
      token_endpoint_auth_method: 'none',
    };
  }

  @Get('authorize')
  @Redirect()
  authorize(@Query() query: Record<string, string>) {
    if (!isLoopbackRedirect(query.redirect_uri)) {
      throw new HttpException('redirect_uri must be a loopback address', HttpStatus.BAD_REQUEST);
    }
    const origin = this.config.get('WEBAUTHN_ORIGIN', 'http://localhost:5173');
    const params = new URLSearchParams(query).toString();
    return { url: `${origin}/oauth-consent?${params}` };
  }

  @Post('authorize/approve')
  @UseGuards(AuthGuard)
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ApproveAuthorizeDto,
  ) {
    if (!isLoopbackRedirect(body.redirectUri)) {
      throw new HttpException('redirect_uri must be a loopback address', HttpStatus.BAD_REQUEST);
    }
    const { token } = await this.tokens.create(
      user.userId,
      'Claude Desktop (OAuth)',
      'oauth',
    );
    const code = this.codes.create({
      userId: user.userId,
      token,
      redirectUri: body.redirectUri,
      codeChallenge: body.codeChallenge,
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    const redirectUrl = new URL(body.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (body.state) redirectUrl.searchParams.set('state', body.state);
    return { redirectUrl: redirectUrl.toString() };
  }

  @Post('token')
  @HttpCode(201)
  async token(@Body() body: TokenExchangeDto) {
    const entry = this.codes.consume(body.code);
    if (
      !entry ||
      entry.redirectUri !== body.redirect_uri ||
      !verifyPkce(body.code_verifier, entry.codeChallenge)
    ) {
      throw new HttpException({ error: 'invalid_grant' }, HttpStatus.BAD_REQUEST);
    }
    return { access_token: entry.token, token_type: 'Bearer' };
  }
}
```

- [ ] **Step 6: Wire up `OauthModule`**

Create `server/src/oauth/oauth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { OauthMetadataController } from './oauth-metadata.controller';
import { OauthController } from './oauth.controller';
import { OauthCodeStore } from './oauth-code.store';

@Module({
  imports: [AgentModule, AuthGuardModule],
  controllers: [OauthMetadataController, OauthController],
  providers: [OauthCodeStore],
})
export class OauthModule {}
```

Add it to `server/src/app.module.ts`: add `import { OauthModule } from './oauth/oauth.module';` near the other domain-module imports, and add `OauthModule` to the `imports` array (after `AgentModule`).

- [ ] **Step 7: Exclude the well-known route from the global `api` prefix**

In `server/src/main.ts`, change:

```ts
  app.setGlobalPrefix('api');
```

to:

```ts
  app.setGlobalPrefix('api', {
    exclude: ['.well-known/oauth-authorization-server'],
  });
```

Make the identical change in `server/test/utils/app.ts` (same `setGlobalPrefix('api')` call), so e2e tests exercise the same routing as production.

- [ ] **Step 8: Proxy the well-known path through nginx (prod) and Vite (dev)**

In `client/nginx.conf`, add a new `location` block above the existing `location /api/ { ... }` block:

```nginx
  location = /.well-known/oauth-authorization-server {
    proxy_pass http://finance-tracker-server:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
```

In `client/vite.config.ts`, add the same path to the dev proxy map:

```ts
    proxy: {
      '/api': 'http://localhost:3000',
      '/.well-known/oauth-authorization-server': 'http://localhost:3000',
    },
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx jest test/oauth.e2e.spec.ts --workspace server`
Expected: PASS (9 tests).

- [ ] **Step 10: Run the full server test suite to confirm nothing else broke**

Run: `npm test --workspace server`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add server/src/oauth server/src/app.module.ts server/src/main.ts server/test/utils/app.ts server/test/oauth.e2e.spec.ts client/nginx.conf client/vite.config.ts
git commit -m "feat: add OAuth discovery/register/authorize/token endpoints for MCP"
```

---

### Task 6: Frontend — OAuth consent page + login redirect-back

**Files:**
- Create: `client/src/pages/OAuthConsentPage.tsx`
- Create: `client/src/pages/OAuthConsentPage.spec.tsx`
- Modify: `client/src/pages/LoginPage.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `client/src/auth-context.tsx` (existing, unchanged); `POST /oauth/authorize/approve` (Task 5) → `{ redirectUrl: string }`.
- Produces: route `/oauth-consent`; `LoginPage` now honors a `next` query param on successful login (no other consumer).

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/OAuthConsentPage.spec.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OAuthConsentPage from './OAuthConsentPage';
import { api } from '../api';
import { useAuth } from '../auth-context';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, api: vi.fn() };
});

vi.mock('../auth-context', () => ({
  useAuth: vi.fn(),
}));

const mockedApi = vi.mocked(api);
const mockedUseAuth = vi.mocked(useAuth);

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/oauth-consent" element={<OAuthConsentPage />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OAuthConsentPage', () => {
  beforeEach(() => {
    mockedApi.mockReset();
    mockedUseAuth.mockReset();
  });

  it('redirects to login, preserving the original query, when not authenticated', async () => {
    mockedUseAuth.mockReturnValue({ user: null, loading: false, refresh: vi.fn() });
    renderAt(
      '/oauth-consent?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcb&state=xyz&code_challenge=chal&code_challenge_method=S256',
    );
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
  });

  it('shows nothing while auth is loading', () => {
    mockedUseAuth.mockReturnValue({ user: null, loading: true, refresh: vi.fn() });
    renderAt('/oauth-consent?redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcb');
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('calls approve with the query params when authenticated', async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'a@b.com' },
      loading: false,
      refresh: vi.fn(),
    });
    mockedApi.mockResolvedValueOnce({
      redirectUrl: 'http://127.0.0.1:1234/cb?code=abc&state=xyz',
    });
    renderAt(
      '/oauth-consent?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcb&state=xyz&code_challenge=chal&code_challenge_method=S256',
    );
    await waitFor(() => screen.getByRole('button', { name: /approve/i }));
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/oauth/authorize/approve', {
        method: 'POST',
        body: {
          redirectUri: 'http://127.0.0.1:1234/cb',
          state: 'xyz',
          codeChallenge: 'chal',
          codeChallengeMethod: 'S256',
        },
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pages/OAuthConsentPage.spec.tsx --workspace client`
Expected: FAIL — `./OAuthConsentPage` doesn't exist yet.

- [ ] **Step 3: Implement `OAuthConsentPage.tsx`**

Create `client/src/pages/OAuthConsentPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { api, ApiError } from '../api';
import Button from '../components/Button';
import AuthCard from '../components/AuthCard';

export default function OAuthConsentPage() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      const next = `/oauth-consent?${searchParams.toString()}`;
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    }
  }, [loading, user, navigate, searchParams]);

  async function approve() {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ redirectUrl: string }>('/oauth/authorize/approve', {
        method: 'POST',
        body: {
          redirectUri: searchParams.get('redirect_uri'),
          state: searchParams.get('state') ?? undefined,
          codeChallenge: searchParams.get('code_challenge'),
          codeChallengeMethod: searchParams.get('code_challenge_method'),
        },
      });
      window.location.href = res.redirectUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve access.');
      setBusy(false);
    }
  }

  if (loading || !user) return null;

  return (
    <AuthCard title="Connect an AI agent">
      <p className="mb-4 text-sm text-muted">
        Allow this application to access your finance data using your account?
      </p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button onClick={approve} disabled={busy} className="w-full">
        Approve
      </Button>
    </AuthCard>
  );
}
```

- [ ] **Step 4: Add the `/oauth-consent` route**

In `client/src/App.tsx`, add the import:

```tsx
import OAuthConsentPage from './pages/OAuthConsentPage';
```

And add the route (not wrapped in `ProtectedRoute`/`Layout` — the page manages its own auth check so it can preserve the OAuth query params on redirect), alongside the other unauthenticated-shell routes:

```tsx
          <Route path="/oauth-consent" element={<OAuthConsentPage />} />
```

- [ ] **Step 5: Make `LoginPage` honor a `next` query param**

In `client/src/pages/LoginPage.tsx`, add `useSearchParams` to the import:

```tsx
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
```

Add inside the component, alongside the existing `useNavigate()` call:

```tsx
  const [searchParams] = useSearchParams();
```

Replace the line `navigate('/dashboard');` in `onSubmit` with:

```tsx
      navigate(searchParams.get('next') ?? '/dashboard');
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/pages/OAuthConsentPage.spec.tsx --workspace client`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the full client test suite to confirm nothing else broke**

Run: `npm test --workspace client`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/OAuthConsentPage.tsx client/src/pages/OAuthConsentPage.spec.tsx client/src/pages/LoginPage.tsx client/src/App.tsx
git commit -m "feat: add OAuth consent page and login redirect-back for the MCP OAuth flow"
```

---

### Task 7: Manual verification with Playwright

**Files:** none (verification only, no code changes).

**Interfaces:** none — this task consumes the fully wired system from Tasks 1-6 end to end.

- [ ] **Step 1: Start the dev stack**

Run: `docker compose up -d mongo` (if not already running), then in separate terminals: `npm run start:dev --workspace server` and `npm run dev --workspace client`.

- [ ] **Step 2: Drive the reworked Settings token table**

Using the Playwright MCP tools: log in, navigate to `/settings/agent`, create a token with a label, confirm it appears in the table with `source: manual` and the copy-paste `claude mcp add` command renders, then revoke it and confirm it disappears from the table. Take a screenshot of the populated table.

- [ ] **Step 3: Drive the OAuth consent flow end to end**

With the Playwright MCP tools, while logged out, navigate to:
`http://localhost:5173/api/oauth/authorize?client_id=test&redirect_uri=http%3A%2F%2F127.0.0.1%3A9999%2Fcallback&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&response_type=code`
(this `code_challenge` is the S256 hash of the verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`, a fixed well-known PKCE test vector — fine for manual verification since it's not asserting security here, just the UI flow).
Confirm it redirects to `/login`, log in, confirm it lands on the consent screen (not back on `/login`), click Approve, and confirm the browser attempts to navigate to `http://127.0.0.1:9999/callback?code=...&state=xyz` (a connection error there is expected and fine — nothing is listening on that port; the point is confirming the redirect URL is correct). Screenshot the consent screen before clicking Approve.

- [ ] **Step 4: Confirm discovery metadata is reachable through the dev proxy**

Using the Playwright MCP tools (or a fetch from the browser console), request `http://localhost:5173/.well-known/oauth-authorization-server` and confirm it returns the JSON metadata document (proves the Vite proxy addition from Task 5 works, mirroring what nginx will do in prod).

- [ ] **Step 5: Report results**

Summarize what was verified and attach the two screenshots. No commit — this task produces no file changes.
