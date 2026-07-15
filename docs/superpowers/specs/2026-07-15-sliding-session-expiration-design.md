# Sliding session expiration

## Problem

Sessions currently have a fixed expiry set once at creation (`SessionService.create()`): 30 days for `full` scope, 15 minutes for pending scopes. `AuthGuard`/`SessionService.validate()` only reads and checks `expiresAt`, never extends it. A user who is active every day still gets logged out exactly 30 days after their session was created.

## Design

Add sliding (renew-on-use) expiration for `full`-scope sessions only.

- **Where:** `SessionService.validate()` in `server/src/auth-guard/session.service.ts`.
- **Trigger:** threshold-based, not renew-on-every-request. After fetching a valid session, if `session.scope === 'full'` and the remaining time until `expiresAt` is less than half of `fullTtlMs`, rewrite `expiresAt` to `now + fullTtlMs`.
  - With the default 30-day TTL, a session renews the first time it's used after day 15, resetting to a fresh 30-day window.
  - This bounds the DB write to roughly once per `fullTtlMs / 2` per session, instead of once per request.
- **Renewal write is fire-and-forget:** don't block `validate()`'s return on the `updateOne` completing — session renewal isn't itself security-critical (worst case a borderline session isn't renewed this request and gets renewed next time, or the user re-authenticates a bit early).
- **Pending sessions are untouched.** `scope !== 'full'` (e.g. `pending_passkey`) always keeps its original fixed 15-minute window — no sliding renewal. These are short-lived registration/login flows, not sessions a user should be "kept alive" in.
- **No absolute cap.** As long as a full session is used at least once within any `fullTtlMs`-sized window, it renews indefinitely. No second "hard max age" timestamp is introduced.
- **No new endpoint and no client changes.** Renewal piggybacks on every existing authenticated request through `AuthGuard`, so nothing else in the auth flow changes.

## Testing

Unit tests on `SessionService.validate()`:
1. A full session well within its TTL (remaining time ≥ half of `fullTtlMs`) is *not* renewed — `expiresAt` unchanged.
2. A full session past the threshold (remaining time < half of `fullTtlMs`) has `expiresAt` pushed forward to `now + fullTtlMs`.
3. A pending session is never renewed, regardless of how much of its TTL remains.

## Out of scope

- Absolute/hard session lifetime cap independent of activity.
- Any change to pending-session TTL behavior.
- Client-side changes (no polling/heartbeat needed — renewal is a side effect of normal API usage).
