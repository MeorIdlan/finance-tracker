# MCP Agent Endpoint — Design

**Date:** 2026-07-20
**Status:** Approved by user

## Problem

The user wants to connect an AI agent (Claude Code CLI initially) to their finance
tracker so it can record transactions and pull summaries on their behalf, without
sharing their passkey-protected session. This requires a separate, non-session
authentication mechanism (a bearer token), a remote MCP server exposing a small set of
tools backed by existing domain services, and a Settings sub-page where the user can
generate/rotate that token and copy a ready-to-use connection command.

The production Cloudflare tunnel currently only exposes the `finance-tracker-client`
container. No tunnel/infra change is required: `client/nginx.conf` already reverse
proxies all of `/api/` to `finance-tracker-server`, so an MCP endpoint under
`/api/mcp` is reachable through the existing tunnel today.

## Decisions made during brainstorming

- **Tool scope (v1):** `create_transaction`, `get_summary`, `list_transactions`,
  `list_accounts` (accounts, commitments, loans, credit cards). No edit/delete tools in
  v1 — the agent can create and read, not mutate/destroy existing records.
- **Write safety:** tools execute immediately, same trust level as a logged-in
  session. Token possession is the authorization boundary; no dry-run/confirm step.
- **Token model:** one active bearer token per user. v1 supports **rotate only** (no
  separate revoke-without-replace) — rotating immediately invalidates the old token by
  overwriting its hash.
- **Target client for the setup guide:** Claude Code CLI, via a copy-pastable
  `claude mcp add --transport http ...` command.
- **Audit tagging:** actions taken via the MCP token are tagged `actor: 'agent'` in the
  audit log, distinguishable from `actor: 'user'` web-UI actions.

## Architecture & changes

**Transport:** the official `@modelcontextprotocol/sdk` (new server dependency),
using `McpServer` + `StreamableHTTPServerTransport` in **stateless mode** — a fresh
`McpServer`/transport pair is constructed per HTTP request (`sessionIdGenerator:
undefined`), not persisted across requests. This is the SDK's supported pattern for a
simple remote HTTP MCP server and avoids hand-rolling JSON-RPC framing or session-id
bookkeeping.

**New `ApiToken` schema** (`server/src/database/schemas/api-token.schema.ts`),
registered in the `@Global()` `DatabaseModule` alongside the other schemas:

```
{
  userId: ObjectId (unique index — one token per user),
  tokenHash: string (sha256, same hashing pattern as Session.tokenHash),
  createdAt: Date,
  lastUsedAt?: Date,
}
```

Token string format: `ftk_<32 random bytes, base64url>` — prefixed so it's
recognizable in the wild (e.g. if accidentally pasted somewhere), generated with
`crypto.randomBytes`, hashed with `sha256` before storage (plaintext is never
persisted, mirroring `SessionService`'s `hashToken`).

**New `agent` server module** (`server/src/agent/`), following the existing
modular-by-domain layout:

- `agent-token.service.ts` — `rotate(userId)` generates a new token, upserts the
  `ApiToken` doc (create-or-replace), returns the plaintext once; `status(userId)`
  returns `{ hasToken, createdAt, lastUsedAt }`, never the plaintext.
- `agent-token.controller.ts` — `GET /agent-token/status` and `POST
  /agent-token/rotate`, both behind the existing cookie-based `AuthGuard` (full session
  required — rotating a token is a sensitive action, same trust bar as adding a
  passkey).
- `bearer-auth.guard.ts` — a `CanActivate` guard parallel to (not reusing)
  `auth-guard/auth.guard.ts`. Reads `Authorization: Bearer <token>`, hashes it, looks up
  `ApiToken`, resolves the owning user, updates `lastUsedAt`, and attaches `req.user`
  with `authMethod: 'agent'`. Missing/unknown/rotated-out token → 401, same shape as the
  cookie guard's 401s.
- `mcp.controller.ts` — `POST /mcp` (reachable at `/api/mcp` through the client nginx
  proxy), guarded by `BearerAuthGuard`. Constructs a stateless `McpServer` per request,
  registers the four v1 tools (each closed over the resolved `userId`), and hands off to
  `StreamableHTTPServerTransport`.
- `mcp-tools.service.ts` — tool implementations. Each tool calls into the **existing**
  domain services rather than duplicating logic:
  - `create_transaction` → `TransactionsService.create(...)` (same transactional
    balance-update path used by the REST route), passing `actor: 'agent'` through to
    the audit-log call.
  - `get_summary` → `DashboardService.computeSummary` (folds in balances and upcoming
    bills).
  - `list_transactions` → existing transaction query path, filterable by date range,
    category, and account.
  - `list_accounts` → bank accounts, commitments, loans, and credit cards (balances,
    due dates, limits).
  - Input validation reuses the same rules as the REST DTOs (valid category/account
    references, integer sen amounts, UTC dates via `common/dates.ts`); validation
    failures surface as MCP `tools/call` errors, not raw 500s.

**Audit log** (`server/src/audit/`): `AuditEntry` gains an optional `actor?: 'user' |
'agent'` field; `AuditLogService.log()` defaults it to `'user'` when omitted, so every
existing call site is unchanged. `TransactionsService.create()` gains an optional
`actor` parameter threaded through to its audit-log call, defaulting to `'user'` for
the REST path.

**Frontend:** new page `client/src/pages/AgentPage.tsx` at route `/settings/agent`,
linked from `SettingsPage.tsx` (kept as a separate page rather than growing
`SettingsPage` further, matching the existing separation of concerns there):

- Status panel showing whether a token exists, and its `createdAt`/`lastUsedAt`.
- "Generate token" (first time) / "Rotate token" (subsequent) button. On success, shows
  the plaintext token once in a copy box with a "won't be shown again" warning.
- A copy-pastable command block:
  ```
  claude mcp add --transport http finance-tracker https://<origin>/api/mcp --header "Authorization: Bearer <TOKEN>"
  ```
  `<origin>` is filled from `window.location.origin`; `<TOKEN>` is filled only
  immediately after a generate/rotate action (not persisted in page state longer than
  that).
- A short reference section listing the four available tools and what each does, for
  the user's own reference when reviewing agent activity later.

**Dependencies:** add `@modelcontextprotocol/sdk` to `server/package.json`.

**Docs:** update `docs/deployment.md` if any new env vars are introduced (none
expected — token TTL/format are hardcoded for v1, no new config).

## Error handling & security

- `BearerAuthGuard` failures (missing header, malformed token, unknown hash, rotated-out
  hash) → `401 Unauthorized`, consistent with the existing cookie `AuthGuard`.
- `/agent-token/rotate` and `/agent-token/status` require a full cookie session — an
  attacker with only an agent token cannot mint themselves a new one or view rotation
  metadata through the MCP surface, since those routes aren't exposed as MCP tools.
- The global IP-based `ThrottlerGuard` (`APP_GUARD`) still applies to `/api/mcp` like
  every other route; no additional throttling is introduced for v1 given this is a
  single-user self-hosted app.
- MCP tool input validation errors are returned as MCP-level tool errors (readable by
  the agent, so it can retry/correct), not uncaught exceptions.
- Rotating a token immediately invalidates the previous one (old `tokenHash` is
  overwritten in the same document, not soft-deleted) — no window where both old and
  new tokens work.

## Testing

- `agent-token.service.spec.ts`: rotate generates a new hash and invalidates the old
  one; status never returns plaintext; first-time generate vs. subsequent rotate both
  work through the same upsert path.
- `bearer-auth.guard.spec.ts`: valid token resolves the correct user and updates
  `lastUsedAt`; missing/invalid/rotated-out token → 401.
- `mcp-tools.service.spec.ts`: each tool delegates to the correct existing domain
  service with the correct arguments; `create_transaction` results in an audit entry
  with `actor: 'agent'`.
- e2e (`server/test/*.e2e.spec.ts`): full round trip — rotate a token via the
  cookie-authenticated route, then hit `/api/mcp` with it through `initialize` →
  `tools/list` → `tools/call create_transaction`, and assert the transaction, balance
  update, and `actor: 'agent'` audit entry all land correctly. Also cover the negative
  case (old token stops working immediately after rotate).
- Client: `AgentPage` covered like `SettingsPage` — render, generate/rotate flow shows
  the token once, copy-command reflects the current origin.
