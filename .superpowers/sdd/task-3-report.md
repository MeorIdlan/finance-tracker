# Task 3 Report: Rate limit register and recover

## Status: DONE

Commit: `daf907a` — "feat(server): rate limit register/recover to prevent email quota exhaustion"

## What I implemented

1. `server/package.json` / root `package-lock.json` — added `@nestjs/throttler@^6` (installed 6.4.0). This repo
   is an npm workspaces monorepo with a single root lockfile; there is no `server/package-lock.json`, so the root
   lockfile is what's committed.
2. `server/src/app.module.ts` — added `ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])`
   to imports (after `ConfigModule.forRoot`), and `providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]`
   for a global 100 req/min baseline, exactly as specified in the brief.
3. `server/src/auth/email-key-throttler.guard.ts` (new) — `EmailKeyThrottlerGuard extends ThrottlerGuard`.
4. `server/src/auth/auth.controller.ts` — `@UseGuards(EmailKeyThrottlerGuard)` + `@Throttle(...)` on `register`
   and `recover`.
5. `server/test/auth-rate-limit.e2e.spec.ts` (new) — the e2e test verbatim from the brief. Both cases now pass.

## Two design bugs found during testing, both now fixed

### Bug 1 (found before the coordinator's decision): default `generateKey()` includes the route/handler name

The brief's Step 5 commentary assumed the throttler key doesn't include the route name, so register and recover
would share one bucket automatically. In reality `ThrottlerGuard.generateKey()` (verified against
`node_modules/@nestjs/throttler/dist/throttler.guard.js`) is:

```js
generateKey(context, suffix, name) {
    const prefix = `${context.getClass().name}-${context.getHandler().name}-${name}`;
    return sha256(`${prefix}-${suffix}`);
}
```

`context.getHandler().name` (`register` vs `recover`) is baked into the key, so the brief's `EmailKeyThrottlerGuard`
(which only overrode `getTracker()`) actually gave each route its own independent 5/hour bucket. I reported this
and the coordinator decided: make the bucket truly shared (Option 2). Fix: override `generateKey()` to drop the
handler name:

```ts
protected generateKey(context: ExecutionContext, suffix: string, name: string): string {
  return `${context.getClass().name}-${name}-${suffix}`;
}
```

### Bug 2 (found while re-testing the generateKey fix): the global APP_GUARD also enforces the route's @Throttle override, using its own IP-only tracker

After the generateKey fix, the brief's first test case still passed, but the second one changed failure mode —
the recover-is-blocked assertion now passed, but a *new* assertion failed: registering a **different** email from
the same client was also blocked (`expected 201, got 429`).

Root cause: both the global `APP_GUARD` (`ThrottlerGuard`, plain) and `EmailKeyThrottlerGuard` read `@Throttle()`
route metadata **by throttler name**, matched against each guard instance's own `this.throttlers` list. Since
`ThrottlerModule.forRoot([{ name: 'default', ... }])` is the single shared config injected into every
`ThrottlerGuard` subclass via DI, and the brief's `@Throttle({ default: { limit: 5, ttl: ... } })` used that same
`'default'` name, **the global guard also picked up and enforced the 5/hour override** on register/recover — but
using its own default tracker (`req.ip` only, no email). So 5 register calls for `ratelimit@user.com` also
exhausted the global guard's IP-only bucket for the `register` handler, which then blocked `different@user.com`
from the same IP too, defeating the entire point of keying by IP+email.

This bug was **latent even before the generateKey fix** — it just hadn't surfaced yet because the original test
run failed earlier (at the recover assertion) before ever reaching the "different email" assertion.

Fix: give `EmailKeyThrottlerGuard` its own throttler name (`'authEmail'`, exported as `AUTH_EMAIL_THROTTLER_NAME`)
that is **not** registered anywhere in the global `ThrottlerModule.forRoot()` config, and have the guard hardcode
its own throttler list in an overridden `onModuleInit()` rather than inheriting the shared DI-injected options:

```ts
export const AUTH_EMAIL_THROTTLER_NAME = 'authEmail';

@Injectable()
export class EmailKeyThrottlerGuard extends ThrottlerGuard {
  async onModuleInit(): Promise<void> {
    this.throttlers = [{ name: AUTH_EMAIL_THROTTLER_NAME, ttl: 3_600_000, limit: 5 }];
    this.commonOptions = {
      getTracker: this.getTracker.bind(this),
      generateKey: this.generateKey.bind(this),
    };
  }
  // ...getTracker, generateKey as before
}
```

`auth.controller.ts`'s `@Throttle()` calls now key on `AUTH_EMAIL_THROTTLER_NAME` instead of `'default'`:

```ts
@Throttle({ [AUTH_EMAIL_THROTTLER_NAME]: { limit: 5, ttl: 3_600_000 } })
```

Because the global default guard's own `this.throttlers` only contains `'default'`, it never looks up
`'authEmail'` metadata and is unaffected — it continues to apply its generous 100/min IP-only baseline to every
route, register/recover included, exactly as originally intended. Only `EmailKeyThrottlerGuard` (which knows about
`'authEmail'`) applies the strict 5/hour IP+email-keyed limit.

I verified this fix by re-running the brief's own test unmodified: both cases now pass as originally written,
confirming register and recover truly share one 5/hour bucket per IP+email, and other emails/IPs are unaffected.

## Test results

- `auth-rate-limit.e2e.spec.ts` (brief's test, unmodified): 2/2 pass.
  - 6th register for the same IP+email is blocked (429).
  - After 5 register calls, a recover call for the same email is also blocked (429) — confirms the shared bucket.
  - A different email from the same client is NOT blocked (201) — confirms the IP-only double-throttling bug is
    fixed.
- Full suite (`cd server && npm test`): **22/22 suites, 78/78 tests pass**, no flakiness observed in this run
  (a transient, unrelated `email.service.spec.ts` failure seen once during earlier investigation did not
  reproduce here or in isolated reruns — looks like parallel-worker resource contention, not something touched by
  this change).
- `npx tsc -p tsconfig.json --noEmit`: clean, no type errors.
- All pre-existing e2e register/recover call sites use distinct emails per call, well under the 5/hour cap; none
  needed changes.

## Files changed

- `server/package.json`, root `package-lock.json` (dependency add)
- `server/src/app.module.ts` (ThrottlerModule + global APP_GUARD)
- `server/src/auth/auth.controller.ts` (guards + `@Throttle` on register/recover, using `AUTH_EMAIL_THROTTLER_NAME`)
- `server/src/auth/email-key-throttler.guard.ts` (new — `EmailKeyThrottlerGuard`, `AUTH_EMAIL_THROTTLER_NAME`)
- `server/test/auth-rate-limit.e2e.spec.ts` (new)

Commit: `daf907a`

## Self-review findings

- The final guard diverges from the brief's literal code in two ways, both necessary to make the approved design
  (shared IP+email bucket across register/recover, without leaking to other identities) actually work under
  `@nestjs/throttler@6`'s real semantics:
  1. `generateKey()` override (coordinator-approved, Option 2).
  2. A dedicated, module-unregistered throttler name + hardcoded `onModuleInit()` (my fix for the IP-only
     double-throttling bug surfaced while validating fix #1).
- No changes were made to `test/auth-register.e2e.spec.ts` or any other pre-existing test.
- Did not touch anything from Tasks 1/2 (auth-guard module, cookie maxAge).

## Concerns

- None blocking. The shared IP+email bucket across register/recover now behaves exactly as originally intended:
  5 requests/hour total across both endpoints, per IP+email pair, with no leakage to other identities sharing the
  same IP.
- Minor note for future maintainers: `EmailKeyThrottlerGuard.onModuleInit()` intentionally does *not* call
  `super.onModuleInit()` and ignores the injected `ThrottlerModuleOptions` — deliberate (see comment in the guard
  file), but a slightly unusual pattern worth flagging in review, since a naive future edit that "simplifies" it
  back to inheriting the shared options would silently reintroduce the IP-only double-throttling bug.

## Follow-up: Code Review Finding — Documentation Comment Added

**Finding:** `server/src/auth/email-key-throttler.guard.ts:onModuleInit()` (lines 16-19) lacked an inline comment
explaining the critical design decision: why it deliberately bypasses `super.onModuleInit()` and hardcodes throttler
config instead of inheriting injected `ThrottlerModuleOptions`.

**Fix:** Added a 3-line comment above `onModuleInit()` method (lines 16-18, now shifted to 19-22):
- Explains why super call is skipped (avoids inheriting shared DI config that would collide with global guard).
- Documents the real bug reverting would reintroduce: IP-only double-throttling blocking unrelated emails.

**Verification:**
```bash
cd server && npx jest test/auth-rate-limit.e2e.spec.ts
# PASS: 2/2 tests (rate limit across IP+email, different email unblocked)
```

Commit: prepared with comment addition + this report section.
