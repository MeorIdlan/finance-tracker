# MCP OAuth Shim + Multi-Token Support — Design

**Date:** 2026-07-22
**Status:** Approved by user

## Problem

The MCP endpoint (`docs/superpowers/specs/2026-07-20-mcp-agent-endpoint-design.md`)
authenticates agents via a static bearer token, generated/rotated from Settings and
pasted into a client's config. Claude Code CLI supports this directly. Claude Desktop
does not — for regular (non-Enterprise/API-key) users it only supports connecting to
remote MCP servers via OAuth. There is no real third-party authorization happening
here (this is a single-user self-hosted app); the goal is a minimal OAuth
*handshake* that satisfies Claude Desktop's client behavior end-to-end while still
resolving, underneath, to the exact same bearer-token auth the MCP endpoint already
uses — no changes to `BearerAuthGuard` or `McpController`.

Building this exposed a real problem in the existing token model: `ApiToken` is
unique-per-user and stores only a hash (`server/src/database/schemas/api-token.schema.ts`),
never the plaintext, so there is no way to "hand back the existing token" during an
OAuth exchange without either (a) always rotating — which would silently invalidate
any token a user had manually pasted into another MCP client — or (b) reversibly
storing tokens, a security regression. This design fixes that by moving from one
token per user to a list of independently labeled, creatable, and revocable tokens,
so the OAuth flow can mint its own without touching any others.

## Decisions made during brainstorming

- **OAuth scope:** a minimal shim, but one that matches what Claude Desktop's MCP
  client actually does — it performs RFC 8414 metadata discovery and RFC 7591 dynamic
  client registration before ever calling `/authorize`, so both are implemented (as
  stubs) rather than skipped.
- **`/authorize` page auth:** gated by the existing cookie session (`AuthGuard`), not
  a free-text token paste. Claude Desktop opens it in the system browser; if the user
  isn't logged in they hit the normal login flow first.
- **No token yet:** approving the consent screen always creates a new token — this
  is now cheap and safe since tokens are no longer a shared single slot per user.
- **Multi-token support (full scope):** `ApiToken` becomes a per-user list, each with
  a label, creation/last-used timestamps, and a `source` (`'manual' | 'oauth'`).
  Settings > Agent access becomes a table with per-token revoke and a "create new
  token" action. The OAuth approve flow creates a token labeled
  `"Claude Desktop (OAuth)"` without affecting any other token.
- **Migration:** none — no live token depends on the old schema, so this is a clean
  schema change (drop and recreate the `ApiToken` collection), not a data migration.
- **PKCE:** required (S256), since Claude Desktop's client sends it and it's the
  standard native-app OAuth flow (RFC 8252).
- **`redirect_uri` validation:** must be loopback (`http://127.0.0.1` or
  `http://localhost`, any port) — Claude Desktop's callback listener runs on a
  dynamic local port per launch, so exact-match allowlisting isn't possible; loopback
  is the standard native-app constraint instead.
- **Client registration:** genuinely stubbed — no persisted client records. This is a
  single-user instance, not a multi-tenant OAuth server; `/oauth/register` returns a
  freshly generated `client_id` (public client, no secret) without storing or
  validating anything about the caller.

## Architecture & changes

### `ApiToken` schema rework (`server/src/database/schemas/api-token.schema.ts`)

From unique-per-user to a list:

```
ApiToken {
  _id
  userId:      ObjectId (indexed, not unique)
  label:       string
  tokenHash:   string (sha256, indexed — lookup key for BearerAuthGuard)
  createdAt:   Date
  lastUsedAt?: Date
  source:      'manual' | 'oauth'
}
```

Token string format (`ftk_<32 random bytes base64url>`) and hashing are unchanged
from the existing design.

### `AgentTokenService` (`server/src/agent/agent-token.service.ts`) rework

- `create(userId, label, source)` — generates and inserts a new token, returns the
  plaintext once (never persisted).
- `revoke(userId, tokenId)` — deletes a token scoped to its owner; revoking a token
  that's mid-use just means the next MCP call with it 401s.
- `list(userId)` — returns `{ id, label, createdAt, lastUsedAt, source }[]`, never
  plaintext.
- `resolve(tokenPlaintext)` — unchanged in behavior: hash, look up by `tokenHash`
  (now across all tokens, not one per user), bump `lastUsedAt`, return the owning
  `userId`. Used by `BearerAuthGuard`, which needs no changes.

Replaces the old `rotate()`/`status()` upsert-based API.

### `agent-token.controller.ts` rework

- `GET /agent-token/list` — replaces `/status`.
- `POST /agent-token/create` — body `{ label }`, replaces `/rotate`.
- `DELETE /agent-token/:id` — new, revoke.

All three stay behind the existing cookie-based `AuthGuard` (full session), same
trust bar as before.

### New `OauthModule` (`server/src/oauth/`)

- `oauth.controller.ts`:
  - `GET /.well-known/oauth-authorization-server` — static metadata document
    (`issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`),
    no auth.
  - `POST /oauth/register` — stub RFC 7591 registration. No validation, no
    persistence; returns `{ client_id: <random>, token_endpoint_auth_method: 'none' }`.
  - `GET /oauth/authorize` — no session guard directly (it must be reachable to
    redirect unauthenticated users to login). Validates `redirect_uri` is loopback
    (reject with `400` before redirecting anywhere otherwise — never redirect to a
    non-loopback host). On success, 302s to the frontend
    `/oauth-consent` route, forwarding `client_id`, `redirect_uri`, `state`,
    `code_challenge`, `code_challenge_method` as query params unchanged.
  - `POST /oauth/authorize/approve` — behind `AuthGuard` (full session required).
    Body carries the same params the consent page received. Calls
    `AgentTokenService.create(userId, "Claude Desktop (OAuth)", 'oauth')`, mints a
    single-use authorization code bound to `{ userId, token: <plaintext>,
    redirectUri, codeChallenge, expiresAt: now + 60s }` in `OauthCodeStore`, returns
    `{ redirectUrl: "<redirect_uri>?code=<code>&state=<state>" }` as JSON (the
    frontend navigates the browser there itself — this endpoint doesn't redirect,
    since it's called via `fetch`).
  - `POST /oauth/token` — body `{ grant_type: 'authorization_code', code,
    code_verifier, redirect_uri }`. Looks up the code, verifies it's unexpired and
    unused, verifies `redirect_uri` matches what was stored, verifies
    `code_verifier` against the stored `code_challenge` (S256), deletes the code
    (single-use), returns `{ access_token: <plaintext token>, token_type: "Bearer"
    }`. Any failure → `{ error: "invalid_grant" }` with `400`, no detail on which
    check failed.
- `oauth-code.store.ts` — in-memory `Map<code, {...}>`; entries swept lazily (checked
  against `expiresAt` on lookup, plus a periodic sweep) since this is a
  single-instance deployment (`docs/deployment.md`) and codes live for 60 seconds.
- Depends on `AgentTokenService` (export it from `AgentModule`) and the existing
  `AuthGuard`/`SessionService` for the approve endpoint.

### Frontend changes

- **`client/src/pages/OAuthConsentPage.tsx`** (new), route `/oauth-consent`: reads
  query params from the URL. If no session (same check `SettingsPage`/other
  protected pages already do via `/auth/me`), redirects to
  `/login?next=/oauth-consent?<original query>`. Otherwise shows "Allow Claude
  Desktop to access your finance data?" with an Approve button; on click, POSTs to
  `/oauth/authorize/approve` with the query params and `credentials: 'include'`,
  then sets `window.location.href` to the returned `redirectUrl`.
- **`client/src/pages/AgentPage.tsx`** rework: replaces the single status
  panel/rotate button with a table (label, created, last used, source, Revoke
  button per row) plus a "Create new token" form (label input, shows the plaintext
  once on success exactly as before). The setup-command reference block is
  unchanged except it now reads from whichever row was just created.

### Dependencies

None new — no OAuth library needed; PKCE (S256) is just `crypto.createHash('sha256')`
+ base64url, same primitives already used for token hashing.

### Docs

`docs/deployment.md`: no new env vars. Note (informational only) that Claude
Desktop's OAuth discovery hits `/.well-known/oauth-authorization-server` at the same
origin as `/api`, already covered by the existing nginx proxy — no tunnel/infra
change required, same reasoning as the original MCP endpoint design.

## Error handling & security

- `/oauth/authorize` with a non-loopback `redirect_uri` → `400` before any redirect
  happens, so we never send a browser to an attacker-supplied host.
- `/oauth/authorize/approve` without a valid session → `401` (defense in depth; the
  consent page already redirects to login first).
- `/oauth/token`: expired code, already-used code, `redirect_uri` mismatch, or PKCE
  mismatch all collapse to the same `invalid_grant` `400` — no information about
  which check failed.
- Revoking a token takes effect immediately on the next MCP call using it — no soft
  delete, no grace window (matches the existing rotate-invalidates-immediately
  behavior).
- The global IP-based `ThrottlerGuard` still applies to all new routes; no
  additional throttling introduced, same reasoning as the original MCP design
  (single-user self-hosted app).
- `/oauth/register` intentionally does no validation — acceptable because it issues
  no privileged capability by itself; a `client_id` alone grants nothing without a
  subsequent authenticated `/oauth/authorize/approve`.

## Testing

- `agent-token.service.spec.ts` (rewritten): `create` inserts independent tokens
  (multiple per user coexist); `revoke` removes only the targeted token, leaving
  others intact; `list` never returns plaintext; `resolve` finds the right token
  across a user's multiple tokens and bumps only that one's `lastUsedAt`.
- `oauth-code.store.spec.ts` (new): single-use (second lookup after consumption
  fails), expiry (lookup after `expiresAt` fails), independent entries don't
  collide.
- `oauth.controller.spec.ts` / e2e (`server/test/*.e2e.spec.ts`): full round trip —
  discovery → register → authorize (loopback accepted, non-loopback rejected) →
  approve (requires session) → token exchange (correct PKCE verifier succeeds,
  wrong verifier fails, reused code fails, expired code fails) → resulting
  `access_token` works against `POST /mcp` exactly like a manually-created token.
- `bearer-auth.guard.spec.ts`: extend existing coverage to confirm it resolves
  correctly when a user has multiple tokens, and that revoking one doesn't affect
  others' validity.
- Client: `AgentPage` table renders multiple tokens with correct source labels;
  create/revoke flows; `OAuthConsentPage` renders the approve screen and correctly
  redirects unauthenticated visitors to login with `next` preserved.
- Playwright (per `CLAUDE.md`'s UI-testing rule): drive the reworked Settings token
  table (create, revoke) and the `/oauth-consent` approve screen manually in the
  running dev app, screenshot both.
