# Sliding session expiration

## Problem

Sessions currently have a fixed expiry set once at creation (`SessionService.create()`): 30 days for `full` scope, 15 minutes for pending scopes. `AuthGuard`/`SessionService.validate()` only reads and checks `expiresAt`, never extends it. A user who is active every day still gets logged out exactly 30 days after their session was created.

## Design

Add sliding (renew-on-use) expiration for `full`-scope sessions only.

- **Where:** `SessionService.validate()` in `server/src/auth-guard/session.service.ts`.
- **Trigger:** threshold-based, not renew-on-every-request. After fetching a valid session, if `session.scope === 'full'` and the remaining time until `expiresAt` is less than half of `fullTtlMs`, rewrite `expiresAt` to `now + fullTtlMs`.
  - With the default 30-day TTL, a session renews the first time it's used after day 15, resetting to a fresh 30-day window.
  - This bounds the DB write to roughly once per `fullTtlMs / 2` per session, instead of once per request.
- **Renewal write is awaited** inside `validate()` before it returns. (Earlier drafts of this spec called this "fire-and-forget" — that wording was never implemented; a single indexed `updateOne` that fires at most once per `fullTtlMs / 2` per session is cheap enough to await, and awaiting keeps behavior deterministic and testable.)
- **Pending sessions are untouched.** `scope !== 'full'` (e.g. `pending_passkey`) always keeps its original fixed 15-minute window — no sliding renewal. These are short-lived registration/login flows, not sessions a user should be "kept alive" in.
- **No absolute cap.** As long as a full session is used at least once within any `fullTtlMs`-sized window, it renews indefinitely. No second "hard max age" timestamp is introduced.
- **No new endpoint.** Renewal piggybacks on every existing authenticated request through `AuthGuard`.

## Addendum: cookie renewal (added after initial implementation)

The initial implementation only renewed the server-side `Session.expiresAt`. Auth is cookie-based (see CLAUDE.md), and the `sid` cookie is issued once at login with a fixed `maxAge` (`server/src/auth/cookie.ts`, `setSessionCookie`) — it is never reissued afterward. So a server-side-only renewal doesn't achieve the feature's goal: the browser stops sending the cookie at the original fixed deadline regardless of server-side renewal, and the user is logged out anyway. This was caught in final branch review, not anticipated in the original design — the "no client changes" line above was wrong; the cookie's `maxAge` is server-set state that also needs to slide.

**Fix:** `SessionService.validate()` reports whether it renewed the session (add a `renewed: boolean` field to the returned `RequestUser`). `AuthGuard.canActivate()` — which already has access to the `Response` via `ExecutionContext` — reissues the `sid` cookie via `setSessionCookie()` (same token, scope `'full'`, fresh `maxAge`) whenever `renewed` is true. The `renewed` field is stripped before `req.user` is set, so it never leaks into `@CurrentUser()` consumers.

This still requires no new endpoint and no changes outside `server/src/auth-guard/` and the one `setSessionCookie` call site added to `AuthGuard`.

## Testing

Unit tests on `SessionService.validate()`:
1. A full session well within its TTL (remaining time ≥ half of `fullTtlMs`) is *not* renewed — `expiresAt` unchanged.
2. A full session past the threshold (remaining time < half of `fullTtlMs`) has `expiresAt` pushed forward to `now + fullTtlMs`.
3. A pending session is never renewed, regardless of how much of its TTL remains.

## Out of scope

- Absolute/hard session lifetime cap independent of activity.
- Any change to pending-session TTL behavior.
- Client-side changes (no polling/heartbeat needed — renewal is a side effect of normal API usage).
