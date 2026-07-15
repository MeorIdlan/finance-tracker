# Sliding Session Expiration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `full`-scope session expiry on use, so an active user is never logged out mid-session, while pending sessions keep their fixed short TTL.

**Architecture:** All changes live in `SessionService.validate()` (`server/src/auth-guard/session.service.ts`). After a valid session is fetched, if it's `full`-scope and less than half its TTL remains, rewrite `expiresAt` to `now + fullTtlMs` via an awaited `updateOne` before returning. No new endpoints, no schema changes, no client changes — `AuthGuard` already calls `validate()` on every authenticated request.

**Tech Stack:** NestJS, Mongoose, Jest, `mongodb-memory-server` (via `server/test/utils/mongo.ts`, already used in `session.service.spec.ts`).

## Global Constraints

- Renewal applies only to `scope === 'full'` sessions. Pending scopes (e.g. `pending_passkey`) never renew — spec: docs/superpowers/specs/2026-07-15-sliding-session-expiration-design.md.
- Renewal threshold: rewrite `expiresAt` only when remaining time `< fullTtlMs / 2`. Do not renew on every request.
- No absolute/hard cap on total session lifetime — sliding renewal alone governs full-session expiry.
- The renewal write is awaited inside `validate()` before it returns (deviates from the spec's "fire-and-forget" phrasing — a single indexed `updateOne` that fires at most once per `fullTtlMs / 2` per session is cheap enough to await, and this keeps behavior deterministic and testable; no separate unawaited-promise handling is introduced).

---

### Task 1: Sliding renewal in `SessionService.validate()`

**Files:**
- Modify: `server/src/auth-guard/session.service.ts:47-61` (the `validate()` method)
- Test: `server/src/auth-guard/session.service.spec.ts` (add new `describe('sliding expiration', ...)` block)

**Interfaces:**
- Consumes: existing `SessionService.fullTtlMs` (private field, already set in constructor from `SESSION_TTL_DAYS`, default 30 days → `2592000000` ms), existing `Session` schema fields `scope`, `expiresAt`, `_id`.
- Produces: no new public methods or signatures — `validate(token: string): Promise<RequestUser | null>` keeps its exact current signature and return shape. Callers (`AuthGuard`) need no changes.

- [ ] **Step 1: Write the failing tests**

Add this block to the end of `server/src/auth-guard/session.service.spec.ts`, before the final closing `});` of the outer `describe('SessionService', ...)`:

```typescript
  describe('sliding expiration', () => {
    it('does not renew a full session that is well within its TTL', async () => {
      const user = await userModel.create({
        email: 'sliding-fresh@b.com',
        emailVerified: true,
      });
      const token = await service.create(user._id, 'full');
      const before = await sessionModel
        .findOne({ userId: user._id })
        .lean();

      await service.validate(token);

      const after = await sessionModel.findOne({ userId: user._id }).lean();
      expect(after!.expiresAt.getTime()).toBe(before!.expiresAt.getTime());
    });

    it('renews a full session past the halfway point of its TTL', async () => {
      const user = await userModel.create({
        email: 'sliding-stale@b.com',
        emailVerified: true,
      });
      const token = await service.create(user._id, 'full');
      const doc = await sessionModel.findOne({ userId: user._id });
      // fullTtlMs defaults to 30 days; push remaining time to 5 days (< half)
      const staleExpiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await sessionModel.updateOne(
        { _id: doc!._id },
        { expiresAt: staleExpiresAt },
      );

      await service.validate(token);

      const after = await sessionModel.findOne({ _id: doc!._id }).lean();
      expect(after!.expiresAt.getTime()).toBeGreaterThan(
        staleExpiresAt.getTime(),
      );
      // renewed to ~fullTtlMs from now (30 days), not just past the old expiry
      const expectedFloor = Date.now() + 25 * 24 * 60 * 60 * 1000;
      expect(after!.expiresAt.getTime()).toBeGreaterThan(expectedFloor);
    });

    it('never renews a pending session, even near expiry', async () => {
      const user = await userModel.create({
        email: 'sliding-pending@b.com',
        emailVerified: true,
      });
      const token = await service.create(user._id, 'pending_passkey');
      const doc = await sessionModel.findOne({ userId: user._id });
      const nearExpiry = new Date(Date.now() + 1000);
      await sessionModel.updateOne(
        { _id: doc!._id },
        { expiresAt: nearExpiry },
      );

      await service.validate(token);

      const after = await sessionModel.findOne({ _id: doc!._id }).lean();
      expect(after!.expiresAt.getTime()).toBe(nearExpiry.getTime());
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest server/src/auth-guard/session.service.spec.ts --workspace server -t "sliding expiration"`
Expected: FAIL — the "renews a full session past the halfway point" test fails because `expiresAt` is untouched by the current `validate()` (the "does not renew" and "never renews a pending session" tests will pass trivially since no renewal logic exists yet — that's fine, they'll still guard against regressions once renewal is added).

- [ ] **Step 3: Implement sliding renewal**

Replace the `validate()` method in `server/src/auth-guard/session.service.ts` (currently lines 47-61) with:

```typescript
  async validate(token: string): Promise<RequestUser | null> {
    const session = await this.sessionModel.findOne({
      tokenHash: hashToken(token),
      expiresAt: { $gt: new Date() },
    });
    if (!session) return null;
    const user = await this.userModel.findById(session.userId);
    if (!user) return null;

    if (session.scope === 'full') {
      const remainingMs = session.expiresAt.getTime() - Date.now();
      if (remainingMs < this.fullTtlMs / 2) {
        await this.sessionModel.updateOne(
          { _id: session._id },
          { expiresAt: new Date(Date.now() + this.fullTtlMs) },
        );
      }
    }

    return {
      sessionId: session._id.toHexString(),
      userId: session.userId.toHexString(),
      scope: session.scope,
      email: user.email,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest server/src/auth-guard/session.service.spec.ts --workspace server`
Expected: PASS — all tests in the file, including the pre-existing ones and the three new sliding-expiration tests.

- [ ] **Step 5: Run the full server test suite to check for regressions**

Run: `npm test --workspace server`
Expected: PASS — no other suite depends on `expiresAt` staying fixed across a `validate()` call. (If any e2e spec asserts an exact `expiresAt` after hitting an authenticated route, that assertion needs updating to account for renewal — check output for failures before assuming none exist.)

- [ ] **Step 6: Commit**

```bash
git add server/src/auth-guard/session.service.ts server/src/auth-guard/session.service.spec.ts
git commit -m "$(cat <<'EOF'
feat: add sliding expiration for full sessions

Full-scope sessions now renew their 30-day expiry the first time
they're validated after crossing the halfway point of their TTL,
so active users are never logged out mid-session. Pending sessions
keep their fixed short TTL unchanged.
EOF
)"
```

---

### Task 2: Reissue the `sid` cookie on renewal

**Context:** Task 1 made `SessionService.validate()` slide the *server-side* `Session.expiresAt` forward, but the browser's `sid` cookie itself is issued once at login with a fixed `maxAge` (`server/src/auth/cookie.ts:setSessionCookie`) and is never reissued afterward. So the browser stops sending the cookie at the original fixed deadline regardless of server-side renewal — the feature's actual goal (active users never logged out) isn't met yet. See the "Addendum: cookie renewal" section of `docs/superpowers/specs/2026-07-15-sliding-session-expiration-design.md`.

**Files:**
- Modify: `server/src/auth-guard/session.service.ts` (the `RequestUser` interface, and `validate()`)
- Modify: `server/src/auth-guard/auth.guard.ts` (`AuthGuard.canActivate()`)
- Test: `server/src/auth-guard/session.service.spec.ts` (extend the sliding-expiration tests to assert `renewed`)
- Test: `server/test/*.e2e.spec.ts` — check whether an existing e2e spec drives an authenticated request; if one already logs in and hits a `full`-scope route, extend it to assert the `Set-Cookie` header on a renewed request. If none is suitable, add a focused e2e spec: `server/test/session-renewal.e2e.spec.ts`.

**Interfaces:**
- Consumes: `setSessionCookie(res: Response, config: ConfigService, token: string, scope: SessionScope): void` (already exported from `server/src/auth/cookie.ts` — import it into `auth.guard.ts`). Consumes `SessionScope` type from `server/src/database/schemas/session.schema.ts` (already imported in `session.service.ts`).
- Produces: `RequestUser` gains a `renewed: boolean` field (always present, `true` only when this `validate()` call renewed the session). This field must NOT appear on `req.user` / anything `@CurrentUser()` returns to controllers — `AuthGuard` must strip it before attaching.

- [ ] **Step 1: Write the failing tests**

In `server/src/auth-guard/session.service.spec.ts`, update the three tests inside `describe('sliding expiration', ...)` added in Task 1 to also assert the new `renewed` field on the object returned by `validate()`:

```typescript
    it('does not renew a full session that is well within its TTL', async () => {
      const user = await userModel.create({
        email: 'sliding-fresh@b.com',
        emailVerified: true,
      });
      const token = await service.create(user._id, 'full');
      const before = await sessionModel
        .findOne({ userId: user._id })
        .lean();

      const info = await service.validate(token);

      expect(info!.renewed).toBe(false);
      const after = await sessionModel.findOne({ userId: user._id }).lean();
      expect(after!.expiresAt.getTime()).toBe(before!.expiresAt.getTime());
    });

    it('renews a full session past the halfway point of its TTL', async () => {
      const user = await userModel.create({
        email: 'sliding-stale@b.com',
        emailVerified: true,
      });
      const token = await service.create(user._id, 'full');
      const doc = await sessionModel.findOne({ userId: user._id });
      const staleExpiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await sessionModel.updateOne(
        { _id: doc!._id },
        { expiresAt: staleExpiresAt },
      );

      const info = await service.validate(token);

      expect(info!.renewed).toBe(true);
      const after = await sessionModel.findOne({ _id: doc!._id }).lean();
      expect(after!.expiresAt.getTime()).toBeGreaterThan(
        staleExpiresAt.getTime(),
      );
      const expectedFloor = Date.now() + 25 * 24 * 60 * 60 * 1000;
      expect(after!.expiresAt.getTime()).toBeGreaterThan(expectedFloor);
    });

    it('never renews a pending session, even near expiry', async () => {
      const user = await userModel.create({
        email: 'sliding-pending@b.com',
        emailVerified: true,
      });
      const token = await service.create(user._id, 'pending_passkey');
      const doc = await sessionModel.findOne({ userId: user._id });
      const nearExpiry = new Date(Date.now() + 1000);
      await sessionModel.updateOne(
        { _id: doc!._id },
        { expiresAt: nearExpiry },
      );

      const info = await service.validate(token);

      expect(info!.renewed).toBe(false);
      const after = await sessionModel.findOne({ _id: doc!._id }).lean();
      expect(after!.expiresAt.getTime()).toBe(nearExpiry.getTime());
    });
```

Also add a new e2e spec `server/test/session-renewal.e2e.spec.ts`. Check `server/test/utils/` for the existing app-bootstrap and login helpers first (look at any existing `*.e2e.spec.ts` for the pattern of spinning up the Nest app + mongodb-memory-server and completing a login to get a `full`-scope session cookie) and follow that exact pattern. The new spec's core assertion, once a `full`-scope session cookie is obtained and its `expiresAt` is forced stale directly via the `Session` model (same technique as the unit test above — connect to the model via `moduleRef.get(getModelToken(Session.name))` and `updateOne` its `expiresAt` to `now + 5 days`), is:

```typescript
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `sid=${token}`);

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const sidCookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).find(
      (c: string) => c.startsWith('sid='),
    );
    expect(sidCookie).toBeDefined();
    expect(sidCookie).toMatch(/Max-Age=25\d{6}/); // ~29-30 days in seconds, well above the 5-day stale value
```

(Adjust the exact request-building/login helper calls to match whatever pattern the existing e2e specs in `server/test/` use — read one existing e2e spec fully before writing this one, since the brief cannot enumerate the app-bootstrap boilerplate.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest src/auth-guard/session.service.spec.ts -t "sliding expiration"`
Expected: FAIL — `info!.renewed` is `undefined`, not `false`/`true`, since `RequestUser` has no `renewed` field yet.

Run: `cd server && npx jest test/session-renewal.e2e.spec.ts`
Expected: FAIL — no `Set-Cookie` header is sent on the renewed request, since `AuthGuard` never reissues the cookie yet.

- [ ] **Step 3: Add `renewed` to `RequestUser` and set it in `validate()`**

In `server/src/auth-guard/session.service.ts`, change the `RequestUser` interface:

```typescript
export interface RequestUser {
  sessionId: string;
  userId: string;
  scope: SessionScope;
  email: string;
  renewed: boolean;
}
```

Replace the `validate()` method body (from Task 1) with:

```typescript
  async validate(token: string): Promise<RequestUser | null> {
    const session = await this.sessionModel.findOne({
      tokenHash: hashToken(token),
      expiresAt: { $gt: new Date() },
    });
    if (!session) return null;
    const user = await this.userModel.findById(session.userId);
    if (!user) return null;

    let renewed = false;
    if (session.scope === 'full') {
      const remainingMs = session.expiresAt.getTime() - Date.now();
      if (remainingMs < this.fullTtlMs / 2) {
        await this.sessionModel.updateOne(
          { _id: session._id },
          { expiresAt: new Date(Date.now() + this.fullTtlMs) },
        );
        renewed = true;
      }
    }

    return {
      sessionId: session._id.toHexString(),
      userId: session.userId.toHexString(),
      scope: session.scope,
      email: user.email,
      renewed,
    };
  }
```

- [ ] **Step 4: Reissue the cookie in `AuthGuard`**

In `server/src/auth-guard/auth.guard.ts`, add these imports:

```typescript
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { setSessionCookie } from '../auth/cookie';
```

Inject `ConfigService` in the constructor:

```typescript
  constructor(
    private sessions: SessionService,
    private reflector: Reflector,
    private config: ConfigService,
  ) {}
```

In `canActivate()`, after `const user = await this.sessions.validate(token);` and the existing `if (!user) throw new UnauthorizedException();`, and after the existing pending-scope check, replace the tail of the method (currently `(req as Request & { user: unknown }).user = user; return true;`) with:

```typescript
    if (user.renewed) {
      const res = context.switchToHttp().getResponse<Response>();
      setSessionCookie(res, this.config, token, 'full');
    }

    const { renewed, ...requestUser } = user;
    (req as Request & { user: unknown }).user = requestUser;
    return true;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx jest src/auth-guard/session.service.spec.ts`
Expected: PASS — all tests including the updated `renewed` assertions.

Run: `cd server && npx jest test/session-renewal.e2e.spec.ts`
Expected: PASS — the renewed request carries a fresh `Set-Cookie` with an extended `Max-Age`.

- [ ] **Step 6: Run the full server test suite to check for regressions**

Run: `npm test --workspace server`
Expected: PASS. Pay particular attention to any existing e2e spec that logs in and asserts on cookie headers or `req.user` shape — the `renewed` field must not leak onto `req.user`, and unrelated flows must not start setting a `Set-Cookie` header where they didn't before (only `full`-scope, renewed-session requests should).

- [ ] **Step 7: Commit**

```bash
git add server/src/auth-guard/session.service.ts server/src/auth-guard/auth.guard.ts server/src/auth-guard/session.service.spec.ts server/test/session-renewal.e2e.spec.ts docs/superpowers/specs/2026-07-15-sliding-session-expiration-design.md
git commit -m "$(cat <<'EOF'
fix: reissue sid cookie when a session is renewed

Server-side session renewal alone didn't extend the browser's sid
cookie, which kept its original fixed maxAge from login — so active
users still got logged out at the old deadline. AuthGuard now
reissues the cookie with a fresh maxAge whenever validate() reports
the session was renewed.
EOF
)"
```
