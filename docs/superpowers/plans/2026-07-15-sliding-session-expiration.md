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
