# Auth Review Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three of the four deferred findings from the Plan 1 whole-branch review: no rate limiting on `register`/`recover`, the `AuditModule`<->`AuthModule` `forwardRef` cycle, and the session cookie `maxAge` mismatch for `pending_passkey` sessions. The fourth (email enumeration) is confirmed as an accepted v1 trade-off — no code change.

**Architecture:** Extract `AuthGuard` + `SessionService` out of `AuthModule` into a new dependency-free `auth-guard` module, which both `AuthModule` and every route-guarding feature module depend on directly — this removes the `forwardRef` entirely. Add `@nestjs/throttler` with a composite IP+email tracker scoped to the two unauthenticated OTP-triggering routes. Make the session cookie's `maxAge` scope-aware using the same TTL constants `SessionService` already uses.

**Tech Stack:** NestJS 11, Mongoose, Jest + ts-jest, supertest, `@nestjs/throttler` (new).

## Global Constraints

- Money/session/auth conventions per `docs/superpowers/specs/2026-07-12-finance-tracker-design.md` are unchanged by this plan — no schema changes.
- `shared/tsconfig.json` module target must stay `commonjs` — do not touch it.
- Existing full server test suite (`npm test` in `server/`) must pass after every task.
- No new environment variables — throttle limits and TTLs stay hardcoded, consistent with the existing `PENDING_TTL_MS` pattern.
- Route prefix is `/api` (see `test/utils/app.ts:23`) — e2e tests must include it.

---

### Task 1: Extract `auth-guard` module, remove the `forwardRef` cycle

**Files:**
- Create: `server/src/auth-guard/session.service.ts` (moved from `server/src/auth/session.service.ts`)
- Create: `server/src/auth-guard/auth.guard.ts` (moved from `server/src/auth/auth.guard.ts`)
- Create: `server/src/auth-guard/auth-guard.module.ts`
- Create: `server/src/auth-guard/session.service.spec.ts` (moved from `server/src/auth/session.service.spec.ts`)
- Delete: `server/src/auth/session.service.ts`, `server/src/auth/auth.guard.ts`, `server/src/auth/session.service.spec.ts`
- Modify: `server/src/auth/auth.module.ts`
- Modify: `server/src/auth/auth.controller.ts` (import paths only)
- Modify: `server/src/auth/auth.service.ts` (import path only)
- Modify: `server/src/audit/audit.module.ts`
- Modify: `server/src/audit/audit.controller.ts` (import path only)
- Modify: `server/src/transactions/transactions.module.ts`, `server/src/transactions/transactions.controller.ts`
- Modify: `server/src/commitments/commitments.module.ts`, `server/src/commitments/commitments.controller.ts`
- Modify: `server/src/accounts/accounts.module.ts`, `server/src/accounts/bank-accounts.controller.ts`, `server/src/accounts/savings-accounts.controller.ts`
- Modify: `server/src/credit-cards/credit-cards.module.ts`, `server/src/credit-cards/credit-cards.controller.ts`
- Modify: `server/src/passkeys/passkeys.module.ts`, `server/src/passkeys/passkeys.controller.ts`
- Modify: `server/src/loans/loans.module.ts`, `server/src/loans/loans.controller.ts`
- Modify: `server/src/dashboard/dashboard.module.ts`, `server/src/dashboard/dashboard.controller.ts`

**Interfaces:**
- Produces: `AuthGuardModule` (`server/src/auth-guard/auth-guard.module.ts`) exporting `SessionService` and `AuthGuard`. `SessionService` and `AuthGuard`/`AllowPendingSession`/`ALLOW_PENDING_KEY` keep their existing exact signatures, only their file location changes.
- Consumes: nothing new — this task only moves existing code and fixes imports.

- [ ] **Step 1: Move `session.service.ts` and its spec**

```bash
mkdir -p server/src/auth-guard
git mv server/src/auth/session.service.ts server/src/auth-guard/session.service.ts
git mv server/src/auth/session.service.spec.ts server/src/auth-guard/session.service.spec.ts
```

In `server/src/auth-guard/session.service.ts`, update the two relative schema imports (paths change from one level of nesting to the same depth under `src/`, so they're unaffected — verify):

```ts
import { Session, SessionScope } from '../database/schemas/session.schema';
import { User } from '../database/schemas/user.schema';
```

These paths are unchanged since `auth-guard/` is a sibling of `auth/`, both one level under `src/`. No edit needed here — just confirm by reading the file after the move.

In `server/src/auth-guard/session.service.spec.ts`, the imports are also unaffected for the same reason (`../database/...`, `../../test/utils/mongo`). Confirm by reading the file after the move.

- [ ] **Step 2: Move `auth.guard.ts`**

```bash
git mv server/src/auth/auth.guard.ts server/src/auth-guard/auth.guard.ts
```

In `server/src/auth-guard/auth.guard.ts`, the only relative import is `./session.service`, which still resolves correctly since both files moved together. No edit needed — confirm by reading the file.

- [ ] **Step 3: Create `AuthGuardModule`**

```ts
// server/src/auth-guard/auth-guard.module.ts
import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { AuthGuard } from './auth.guard';

@Module({
  providers: [SessionService, AuthGuard],
  exports: [SessionService, AuthGuard],
})
export class AuthGuardModule {}
```

- [ ] **Step 4: Update `AuthModule`**

Replace the full contents of `server/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { WebauthnService } from './webauthn.service';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';

@Module({
  imports: [EmailModule, AuditModule, AuthGuardModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, WebauthnService],
  exports: [WebauthnService],
})
export class AuthModule {}
```

(Dropped: `forwardRef`, `SessionService`, `AuthGuard` from providers/exports — they now live in and are exported by `AuthGuardModule`, which every consumer imports directly instead of going through `AuthModule`.)

- [ ] **Step 5: Fix `AuthController` and `AuthService` import paths**

In `server/src/auth/auth.controller.ts`, change:
```ts
import { AuthGuard, AllowPendingSession } from './auth.guard';
import { RequestUser, SessionService } from './session.service';
```
to:
```ts
import { AuthGuard, AllowPendingSession } from '../auth-guard/auth.guard';
import { RequestUser, SessionService } from '../auth-guard/session.service';
```

In `server/src/auth/auth.service.ts`, change:
```ts
import { SessionService } from './session.service';
```
to:
```ts
import { SessionService } from '../auth-guard/session.service';
```

- [ ] **Step 6: Update `AuditModule` and `AuditController`**

Replace `server/src/audit/audit.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuditLogService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';

@Module({
  imports: [AuthGuardModule],
  controllers: [AuditController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
```

In `server/src/audit/audit.controller.ts`, change:
```ts
import { AuthGuard } from '../auth/auth.guard';
```
to:
```ts
import { AuthGuard } from '../auth-guard/auth.guard';
```

- [ ] **Step 7: Update the 7 consumer modules and their controllers**

For each pair below: in the `.module.ts` file, replace the `AuthModule` import (both the `import` statement and its use in the `imports: []` array) with `AuthGuardModule` from `'../auth-guard/auth-guard.module'`. In each `.controller.ts` file, change the `AuthGuard` import path from `'../auth/auth.guard'` to `'../auth-guard/auth.guard'`.

`server/src/transactions/transactions.module.ts` — replace:
```ts
import { AuthModule } from '../auth/auth.module';
```
with:
```ts
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
```
and in `imports: [...]` replace `AuthModule` with `AuthGuardModule`.
`server/src/transactions/transactions.controller.ts` — change `'../auth/auth.guard'` to `'../auth-guard/auth.guard'`.

`server/src/commitments/commitments.module.ts` — same replacement pattern.
`server/src/commitments/commitments.controller.ts` — same import-path fix.

`server/src/accounts/accounts.module.ts` — same replacement pattern.
`server/src/accounts/bank-accounts.controller.ts` — same import-path fix.
`server/src/accounts/savings-accounts.controller.ts` — same import-path fix.

`server/src/credit-cards/credit-cards.module.ts` — same replacement pattern.
`server/src/credit-cards/credit-cards.controller.ts` — same import-path fix.

`server/src/passkeys/passkeys.module.ts` — same replacement pattern.
`server/src/passkeys/passkeys.controller.ts` — same import-path fix.

`server/src/loans/loans.module.ts` — same replacement pattern.
`server/src/loans/loans.controller.ts` — same import-path fix.

`server/src/dashboard/dashboard.module.ts` — same replacement pattern (this one only imports `AuthModule`, `CreditCardsModule`, `TransactionsModule` — just swap the `AuthModule` piece).
`server/src/dashboard/dashboard.controller.ts` — same import-path fix.

- [ ] **Step 8: Verify no remaining references to the old paths**

```bash
cd server && grep -rn "from '\.\./auth/auth\.guard'\|from '\.\./auth/session\.service'\|from '\./auth\.guard'\|from '\./session\.service'" src/
```

Expected: no output (the only remaining `./auth.guard` / `./session.service` relative imports should be inside `auth-guard/` itself, which this grep from `src/` won't match since those use `./`). If any output appears outside `auth-guard/`, fix that file's import path.

- [ ] **Step 9: Run the full server test suite**

```bash
cd server && npm test
```

Expected: all suites pass (no behavior change, pure file/module reorganization). Pay attention to any Nest DI "cannot resolve dependency" errors, which would indicate a missed import path.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(server): extract auth-guard module to remove AuditModule<->AuthModule cycle

AuthGuard and SessionService move to a new dependency-free auth-guard
module that AuthModule, AuditModule, and every route-guarding feature
module import directly, eliminating the forwardRef cycle between
AuditModule and AuthModule.
EOF
)"
```

---

### Task 2: Fix session cookie `maxAge` for `pending_passkey` sessions

**Files:**
- Modify: `server/src/auth-guard/session.service.ts` (export `PENDING_TTL_MS`)
- Modify: `server/src/auth/cookie.ts`
- Modify: `server/src/auth/auth.controller.ts` (pass scope to `setSessionCookie`)
- Create: `server/src/auth/cookie.spec.ts`

**Interfaces:**
- Consumes: `SessionScope` type from `server/src/database/schemas/session.schema.ts` (already used by `SessionService`).
- Produces: `setSessionCookie(res, config, token, scope: SessionScope)` — new required 4th parameter. `PENDING_TTL_MS` exported constant from `server/src/auth-guard/session.service.ts`.

- [ ] **Step 1: Export `PENDING_TTL_MS` from `SessionService`**

In `server/src/auth-guard/session.service.ts`, change:
```ts
const PENDING_TTL_MS = 15 * 60 * 1000;
```
to:
```ts
export const PENDING_TTL_MS = 15 * 60 * 1000;
```

- [ ] **Step 2: Write the failing test for `setSessionCookie`**

Create `server/src/auth/cookie.spec.ts`:
```ts
import { setSessionCookie, clearSessionCookie } from './cookie';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { PENDING_TTL_MS } from '../auth-guard/session.service';

function mockRes(): { res: Response; opts: Record<string, unknown>[] } {
  const opts: Record<string, unknown>[] = [];
  const res = {
    cookie: (_name: string, _value: string, options: Record<string, unknown>) => {
      opts.push(options);
    },
    clearCookie: () => {},
  } as unknown as Response;
  return { res, opts };
}

describe('setSessionCookie', () => {
  const config = {
    get: (key: string, def?: string) =>
      key === 'SESSION_TTL_DAYS' ? '30' : (def ?? 'false'),
  } as unknown as ConfigService;

  it('uses the 15-minute pending TTL for pending_passkey scope', () => {
    const { res, opts } = mockRes();
    setSessionCookie(res, config, 'tok', 'pending_passkey');
    expect(opts[0].maxAge).toBe(PENDING_TTL_MS);
  });

  it('uses SESSION_TTL_DAYS for full scope', () => {
    const { res, opts } = mockRes();
    setSessionCookie(res, config, 'tok', 'full');
    expect(opts[0].maxAge).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd server && npx jest src/auth/cookie.spec.ts
```

Expected: FAIL — `setSessionCookie` currently takes 3 args, and TypeScript compilation will fail because the 4th argument doesn't match the current signature (or, if TS is lenient about extra args, the test fails on the `maxAge` assertion for `pending_passkey` since it currently returns the 30-day value).

- [ ] **Step 4: Implement the fix**

Replace `server/src/auth/cookie.ts`:
```ts
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SessionScope } from '../database/schemas/session.schema';
import { PENDING_TTL_MS } from '../auth-guard/session.service';

export function setSessionCookie(
  res: Response,
  config: ConfigService,
  token: string,
  scope: SessionScope,
): void {
  const days = parseInt(config.get('SESSION_TTL_DAYS', '30'), 10);
  const fullTtlMs = days * 24 * 60 * 60 * 1000;
  const maxAge = scope === 'full' ? fullTtlMs : PENDING_TTL_MS;
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.get('COOKIE_SECURE', 'false') === 'true',
    maxAge,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie('sid', { path: '/' });
}
```

- [ ] **Step 5: Update call sites in `AuthController`**

In `server/src/auth/auth.controller.ts`, in `verifyOtp` (currently `setSessionCookie(res, this.config, token);` around line 43), change to:
```ts
setSessionCookie(res, this.config, token, 'pending_passkey');
```

In `loginVerify` (currently `setSessionCookie(res, this.config, token);` around line 98), change to:
```ts
setSessionCookie(res, this.config, token, 'full');
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd server && npx jest src/auth/cookie.spec.ts
```

Expected: PASS, both assertions.

- [ ] **Step 7: Run full server test suite**

```bash
cd server && npm test
```

Expected: all suites pass, including `test/auth-register.e2e.spec.ts` and `test/login.e2e.spec.ts` which exercise `verifyOtp`/`loginVerify` cookie-setting paths.

- [ ] **Step 8: Commit**

```bash
git add server/src/auth-guard/session.service.ts server/src/auth/cookie.ts server/src/auth/cookie.spec.ts server/src/auth/auth.controller.ts
git commit -m "$(cat <<'EOF'
fix(server): session cookie maxAge matches actual session scope TTL

pending_passkey sessions now get a 15-minute cookie maxAge instead of
the full 30-day SESSION_TTL_DAYS value. Cosmetic fix — server-side
session expiry enforcement in SessionService.validate was already
correct regardless of the cookie's advertised maxAge.
EOF
)"
```

---

### Task 3: Rate limit `register` and `recover`

**Files:**
- Modify: `server/package.json` (add `@nestjs/throttler`)
- Create: `server/src/auth/email-key-throttler.guard.ts`
- Modify: `server/src/app.module.ts`
- Modify: `server/src/auth/auth.controller.ts`
- Create: `server/test/auth-rate-limit.e2e.spec.ts`

**Interfaces:**
- Produces: `EmailKeyThrottlerGuard` (extends `ThrottlerGuard`), used via `@UseGuards(EmailKeyThrottlerGuard)` + `@Throttle(...)` on `register`/`recover`.
- Consumes: `@nestjs/throttler`'s `ThrottlerModule`, `ThrottlerGuard`, `Throttle`, `ThrottlerRequest` types.

- [ ] **Step 1: Install `@nestjs/throttler`**

```bash
cd server && npm install @nestjs/throttler@^6
```

- [ ] **Step 2: Register `ThrottlerModule` globally in `AppModule`**

In `server/src/app.module.ts`, add imports:
```ts
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
```

Add `ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])` to the `imports` array (after `ConfigModule.forRoot`), and add a `providers` array to the `@Module` decorator:
```ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    DatabaseModule,
    AuditModule,
    EmailModule,
    AuthModule,
    PasskeysModule,
    AccountsModule,
    CommitmentsModule,
    LoansModule,
    CreditCardsModule,
    TransactionsModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

This applies the generous global default (100 req/min) to every route as a baseline abuse guard; it does not interfere with normal usage anywhere else in the app.

- [ ] **Step 3: Write `EmailKeyThrottlerGuard`**

Create `server/src/auth/email-key-throttler.guard.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class EmailKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = (req as { ip?: string }).ip ?? 'unknown';
    const body = (req as { body?: { email?: string } }).body;
    const email = body?.email ?? 'unknown';
    return `${ip}:${email}`;
  }
}
```

- [ ] **Step 4: Apply the guard and throttle limit to `register`/`recover`**

In `server/src/auth/auth.controller.ts`, add imports:
```ts
import { Throttle } from '@nestjs/throttler';
import { EmailKeyThrottlerGuard } from './email-key-throttler.guard';
```

Change the `register` and `recover` handlers:
```ts
  @Post('register')
  @UseGuards(EmailKeyThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async register(@Body() dto: EmailDto) {
    await this.auth.startRegistration(dto.email);
    return { message: 'Verification code sent.' };
  }

  @Post('recover')
  @UseGuards(EmailKeyThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async recover(@Body() dto: EmailDto) {
    await this.auth.startRecovery(dto.email);
    return { message: 'Verification code sent.' };
  }
```

- [ ] **Step 5: Write the e2e test**

Create `server/test/auth-rate-limit.e2e.spec.ts`:
```ts
import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';

describe('register/recover rate limiting', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('blocks the 6th register request within an hour for the same IP+email', async () => {
    for (let i = 0; i < 5; i++) {
      await request(ctx.app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: 'ratelimit@user.com' })
        .expect(201);
    }
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'ratelimit@user.com' })
      .expect(429);
  });

  it('does not block a different email from the same client', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/recover')
      .send({ email: 'ratelimit@user.com' })
      .expect(429);
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'different@user.com' })
      .expect(201);
  });
});
```

Note: both tests share one `ctx` and run sequentially in one `describe` block (matching this repo's existing e2e pattern), so the second test's assumption that `ratelimit@user.com` is already throttled from the first test is valid. The second `recover` call uses the already-registered `ratelimit@user.com` and confirms it's still blocked (recover shares the same IP+email tracker key space as register only if the key is IP+email regardless of route — confirm this is the intended behavior: the throttler key doesn't include the route name, so hitting register 5x then calling recover with the same email will also be blocked. This is correct per the design — the cap is per IP+email pair across both quota-consuming endpoints).

- [ ] **Step 6: Run the new test**

```bash
cd server && npx jest test/auth-rate-limit.e2e.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Run the full server test suite**

```bash
cd server && npm test
```

Expected: all suites pass. Note `test/auth-register.e2e.spec.ts` sends `register` 3 times for `new@user.com` and `two@user.com` combined (2 distinct emails, well under the limit of 5) plus a couple of `recover` calls — confirm it stays under the new 5/hour cap. If any existing e2e test happens to call `register`/`recover` with the same email more than 5 times in one test run, add distinct emails per call rather than loosening the limit.

- [ ] **Step 8: Commit**

```bash
git add server/package.json server/package-lock.json server/src/auth/email-key-throttler.guard.ts server/src/app.module.ts server/src/auth/auth.controller.ts server/test/auth-rate-limit.e2e.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): rate limit register/recover to prevent email quota exhaustion

Adds @nestjs/throttler with a generous global default (100 req/min)
plus a strict 5 requests/hour limit on register and recover, keyed by
IP+email so neither dimension alone evades the cap. Protects against
an attacker spamming OTP requests to burn the monthly MailerSend quota.
EOF
)"
```

---

## Final verification

- [ ] **Run the full server test suite one more time** after all three tasks: `cd server && npm test` — expected all green.
- [ ] **Confirm item 4 (email enumeration) required no code change** — it doesn't; nothing further to do.
