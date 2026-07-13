# Auth Review Follow-ups — Design

**Date:** 2026-07-13
**Branch:** `feat/auth-review-followups`
**Source:** Findings logged in the final Plan 1 whole-branch review (no Critical/Important
issues; these are the four deferred items).

## Scope

Three code changes and one no-op:

1. Rate limiting on `POST /auth/register` and `POST /auth/recover`.
2. Break the `AuditModule` <-> `AuthModule` `forwardRef` cycle via a new shared
   `auth-guard` module.
3. Fix session cookie `maxAge` to match the actual session scope's TTL.
4. Email-enumeration disclosure on `recover`/`login` — **no action**, this is an
   accepted v1 trade-off per `docs/superpowers/specs/2026-07-12-finance-tracker-design.md`
   §3 ("Never return whether an email exists... accepted v1 trade-off, self-hosted app").
   Confirmed out of scope for this branch.

## 1. Rate limiting

**Problem:** `register` and `recover` (`server/src/auth/auth.controller.ts:25-35`) are
unauthenticated, unthrottled `@Post()` routes that trigger an OTP email send
(`AuthService.startRegistration`/`startRecovery`). An attacker can spam either endpoint
to exhaust the monthly MailerSend quota (self-inflicted DoS on email delivery for all
users).

**Approach:** Add `@nestjs/throttler` (v6, matches installed Nest v11).

- `AppModule` registers `ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])`
  as a generous global default (protects against gross abuse elsewhere without
  interfering with normal usage) plus the global `ThrottlerGuard` via `APP_GUARD`.
- A custom `EmailKeyThrottlerGuard extends ThrottlerGuard` overrides `getTracker(req)`
  to return `${req.ip}:${req.body?.email ?? ''}` — composite key so neither rotating
  email nor rotating IP alone evades the limit.
- `register` and `recover` get `@Throttle({ default: { limit: 5, ttl: 3600_000 } })`
  (5 requests / 60 min per composite key) and `@UseGuards(EmailKeyThrottlerGuard)`.
- Lives in `server/src/auth/` (e.g. `email-key-throttler.guard.ts`) since it's
  auth-specific, not reused elsewhere.

**Testing:** unit test hitting `register` 6x with the same IP+email within the window,
asserting the 6th returns 429; a 6th request with a different email (same IP) still
succeeds within the global default.

## 2. `AuditModule` <-> `AuthModule` forwardRef cycle

**Problem:** `AuthModule` imports `AuditModule` (for `AuditLogService`, used in
`AuthController` to log `passkey.added`/`auth.login`/`auth.logout`). `AuditModule`
imports `AuthModule` (for `AuthGuard`, used to guard `AuditController`'s `GET
/audit-log`). Both imports use `forwardRef()`. Correct but avoidable.

**Approach:** Extract the pieces `AuditModule` (and seven other feature modules) only
need for guarding routes into a new `server/src/auth-guard/` module:

- Move `session.service.ts`, `auth.guard.ts` (incl. `AllowPendingSession`/
  `ALLOW_PENDING_KEY`) from `server/src/auth/` to `server/src/auth-guard/`.
- New `AuthGuardModule`: `providers: [SessionService, AuthGuard]`,
  `exports: [SessionService, AuthGuard]`. No imports of `AuthModule` or `AuditModule`.
  (`Session`/`User` mongoose models are already globally registered via
  `DatabaseModule`, so no forFeature wiring changes needed.)
- `AuthModule` imports `AuthGuardModule` (plain) and `AuditModule` (plain, no more
  `forwardRef` — the cycle's gone). `AuthModule`'s own exports list drops
  `SessionService`/`AuthGuard` (they're no longer its providers) and keeps just
  `WebauthnService`.
- `AuditModule` drops its `AuthModule` import, imports `AuthGuardModule` instead
  (plain import, no `forwardRef`).
- The 7 other modules that import `AuthModule` solely for `AuthGuard`
  (`transactions`, `commitments`, `accounts`, `credit-cards`, `passkeys`, `loans`,
  `dashboard`) switch that import to `AuthGuardModule`. Mechanical one-line swap per
  module file; `AuthGuard` import paths in controllers change from `'../auth/auth.guard'`
  to `'../auth-guard/auth.guard'`.
- `auth.service.ts`'s import of `SessionService` from `./session.service` becomes
  `'../auth-guard/session.service'`.

**Testing:** existing test suites should pass unchanged (no behavior change, pure
module/file reorg); run full server suite to confirm no DI wiring breaks.

## 3. Session cookie `maxAge` scope mismatch

**Problem:** `setSessionCookie` (`server/src/auth/cookie.ts:4-17`) always computes
`maxAge` from `SESSION_TTL_DAYS` (30d), even when `verifyOtp`
(`auth.controller.ts:37-45`) creates a `pending_passkey` session with a real 15-minute
server-side TTL (`session.service.ts:9,37`). The cookie's advertised `maxAge` is
cosmetically wrong for that path (server-side enforcement in `SessionService.validate`
is already correct regardless).

**Approach:** `setSessionCookie(res, config, token, scope: SessionScope)` computes
`maxAge` the same way `SessionService.create` computes TTL: 15 min for
`pending_passkey`, `SESSION_TTL_DAYS` for `full`. Export the `PENDING_TTL_MS` constant
from `session.service.ts` (now in `auth-guard/`) so both places share one source of
truth instead of duplicating the literal. Both call sites in `auth.controller.ts`
(`verifyOtp` line 43, `loginVerify` line 98) pass their known scope.

**Testing:** unit test on `setSessionCookie` asserting `maxAge` for each scope value.

## Out of scope

- Item 4 (email enumeration) — no code change, confirmed accepted trade-off.
- No new environment variables needed (throttle limits are hardcoded per the design
  above, consistent with other hardcoded auth constants like `PENDING_TTL_MS`).
