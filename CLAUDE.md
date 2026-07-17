# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted personal finance tracker. Passwordless (WebAuthn passkeys) auth, NestJS + React + MongoDB, single currency (MYR). Design spec: `docs/superpowers/specs/2026-07-12-finance-tracker-design.md`. Implementation plans: `docs/superpowers/plans/`. Deployment: `docs/deployment.md`.

## Commands

Setup:

    cp .env.example .env        # fill in Mailgun key + domain + from-address
    npm install
    npm run build:shared        # must run after any change to shared/src
    docker compose up -d mongo  # single-node replica set; healthcheck auto-runs rs.initiate()

Dev servers:

    npm run start:dev --workspace server   # http://localhost:3000
    npm run dev --workspace client         # http://localhost:5173, proxies /api to :3000

Tests:

    npm test --workspace server             # jest, all specs
    npm test --workspace client             # vitest run
    npx jest <path/to/file.spec.ts> --workspace server   # single server test
    npx vitest run <path/to/file.spec.ts> --workspace client  # single client test

Server tests include both `*.spec.ts` (unit, colocated under `server/src`) and e2e specs under `server/test/*.e2e.spec.ts` (spin up mongodb-memory-server via `server/test/utils/`). Both run under the same `npm test --workspace server` / jest config — there's no separate e2e command.

Build (matches Docker images): `npm run build --workspace shared|server|client`.

## Architecture

**Monorepo workspaces**: `shared` (types only, no runtime logic) → `server` (NestJS) and `client` (React) both depend on `@finance/shared`. Always rebuild `shared` after editing it — `server`/`client` consume its `dist/` output, not `src/` directly.

**Server is modular-by-domain** (`server/src/<domain>/`: auth, auth-guard, passkeys, accounts, commitments, loans, credit-cards, transactions, dashboard, audit, email). `DatabaseModule` (`server/src/database/database.module.ts`) is `@Global()` and registers every Mongoose schema (`server/src/database/schemas/`) in one place — new schemas get added there, not in per-domain modules.

**Auth is session-cookie based, not JWT.** `auth-guard/` is a separate module from `auth/` specifically to break a circular dependency between `AuditModule` and `AuthModule` (see commit `8dc99a2`) — `SessionService` + `AuthGuard` live there so both `auth` and other domain modules can depend on session validation without pulling in the full auth module. Sessions are stored server-side in Mongo (`Session` schema), not in memory — the cookie only holds a session ID (`sid`, httpOnly/Secure/SameSite=Lax). This is why the deployment smoke-test checklist explicitly checks that sessions survive a container restart.

Registration/login/recovery is a multi-step flow (email OTP → passkey ceremony), so sessions can be in a `pending` scope before a passkey is registered. Routes that must be reachable mid-flow (e.g. finishing passkey setup) are marked with the `@AllowPendingSession()` decorator (`auth-guard/auth.guard.ts`); everything else requires `scope === 'full'`.

**Full sessions slide on use.** `SessionService.validate()` extends a `full`-scope session's `expiresAt` (and `AuthGuard` reissues the `sid` cookie with a fresh `maxAge`) the first time it's validated after crossing the halfway point of its TTL — active users are never logged out mid-session. Pending sessions keep their fixed 15-minute window with no renewal. See `docs/superpowers/specs/2026-07-15-sliding-session-expiration-design.md`.

**Two layers of rate limiting on auth email routes** (register/recover) — read `server/src/auth/email-key-throttler.guard.ts` before touching either: the global `APP_GUARD` `ThrottlerGuard` (IP-only, `app.module.ts`) and `EmailKeyThrottlerGuard` (IP+email composite key, its own throttler bucket name deliberately kept out of the global config to avoid double-throttling by IP alone). Don't rename/reuse the `authEmail` throttler name in the global config — that reintroduces the bug this split fixes.

**Financial mutations are transactional.** Every domain entity with a derived running balance (bank account `currentBalance`, commitment due status, loan balance, credit card balance) is updated inside a MongoDB multi-document transaction (`connection.startSession()` + `session.withTransaction()`) alongside the `Transaction` document that caused the change — see `server/src/transactions/transactions.service.ts`. Edits/deletes reverse the old effect and reapply the new one within the same transaction, not via recomputation. There's a separate "recompute from history" repair endpoint as a drift safety net, but it's not the normal code path — don't use it as a substitute for atomic updates in new mutation code.

**Money and dates**: all monetary values are integer sen (RM 12.34 === `1234`) end-to-end — DB, DTOs (`shared/src/index.ts`), and API. Never use floats for money. Client-side conversion helpers are in `client/src/money.ts` (`formatSen`, `parseRM`). Dates for recurring due-date math are handled in UTC via `server/src/common/dates.ts` — use `dueDateInMonth`/`nextDueDateFrom`/`shiftDueDate` rather than ad hoc date arithmetic, since month-end clamping (e.g. due day 31 in February) is already handled there.

**Expense categories** are a fixed const array in `shared/src/index.ts` (`EXPENSE_CATEGORIES`), not a DB collection — both client and server import it as the single source of truth. No per-user customization.

**Audit log** (`server/src/audit/`) captures both financial mutations and auth events; call `AuditService.log()` at the point of mutation rather than reconstructing history later.

## Testing new features

When adding a new feature to the webapp (new page, new UI flow, new interactive behavior), use the Playwright MCP tools to drive the running dev app and visually confirm the feature landed correctly — navigate to it, exercise the golden path, and take a screenshot before considering the work done. This is in addition to, not a replacement for, unit/e2e tests.

## Environment / deployment shape

Dev: client (Vite, :5173) proxies `/api` to server (:3000) so cookies/WebAuthn see one origin. Prod (`docker-compose.prod.yml`): nginx `client` container serves built static assets and reverse-proxies `/api` to `server`; `cloudflared` tunnels HTTPS from Cloudflare's edge to the droplet, terminating TLS there — `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` must match the public hostname exactly or passkey ceremonies fail. Mongo always runs as a single-node replica set (`rs0`) because multi-document transactions require it, in both dev and prod compose files.
