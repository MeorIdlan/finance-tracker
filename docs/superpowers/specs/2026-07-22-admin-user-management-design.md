# Admin user management

## Problem

There is no way to see the list of registered users or revoke a user's access. The app is
admin-gated at registration time (`ADMIN_EMAIL` receives every registration OTP and a human
decides out-of-band whether to relay the code), but once an account exists there's no way to
look at who has one, or to shut one off.

## Access control

Reuse the existing `ADMIN_EMAIL` config value (`server/src/auth/auth.service.ts` already reads
it via `ConfigService.getOrThrow<string>('ADMIN_EMAIL')`). No new env var. Whichever registered
user's `User.email` equals `ADMIN_EMAIL` is the admin — single fixed admin, no roles/permissions
system.

`AuthController.me` (`GET /auth/me`) gains an `isAdmin: boolean` field, computed by comparing
the session's email to `ADMIN_EMAIL`. `AuthUser` (`shared/src/index.ts`) gains the same field.
This lets the client show/hide the admin nav link and route without duplicating the admin-email
check client-side.

## "Delete" = revoke access, not data wipe

Deleting a user disables their access; it does not touch their financial data (transactions,
accounts, commitments, loans, credit cards, audit log). This keeps the action safe to reverse
and avoids cascading deletes across every domain module.

Add `disabled: boolean` (default `false`) to the `User` schema
(`server/src/database/schemas/user.schema.ts`).

Enforcement — two existing chokepoints, no new ones:

- **`SessionService.validate()`** (`server/src/auth-guard/session.service.ts`): after loading
  the user, if `user.disabled` return `null` (same as "no session"). This kills every existing
  session — full or pending — on its very next validated request, without needing to touch the
  `Session` collection.
- **`WebauthnService.authenticationOptions()`** (`server/src/auth/webauthn.service.ts`): add
  `disabled: { $ne: true }` to the existing `userModel.findOne({ email, emailVerified: true })`
  lookup, so a disabled user can't start a new passkey login. Same `NotFoundException` as an
  unknown email — no information leak about account status.
- **`AuthService.startRecovery()`** (`server/src/auth/auth.service.ts`): same
  `disabled: { $ne: true }` filter added to its `userModel.findOne(...)`, so OTP-based recovery
  is blocked too.

Re-enabling a user (`disabled: false`) reverses all three checks immediately — no other state to
restore, since sessions were never deleted, just made unvalidatable while disabled.

## Server: new `admin` module

`server/src/admin/`:

- `AdminGuard` (`admin.guard.ts`): `CanActivate` that reads `req.user` (already populated by
  `AuthGuard`, which must run first) and throws `ForbiddenException` unless
  `req.user.email === ADMIN_EMAIL`. Applied as `@UseGuards(AuthGuard, AdminGuard)` on every route
  in this module.
- `AdminController` (`admin.controller.ts`):
  - `GET /api/admin/users` — list every user: `{ id, email, name, createdAt, emailVerified, disabled }`.
    Sorted by `createdAt` ascending. No pagination (personal-scale app, user count is small).
  - `PATCH /api/admin/users/:id` — body `{ disabled: boolean }`. Sets the field. Returns 400
    (`BadRequestException`) if `:id` resolves to the admin's own `userId` — self-lockout
    prevention applies to both disabling and (trivially, since you can't disable yourself in the
    first place) re-enabling.
  - `GET /api/admin/users/:id` not needed — the list view is the only read.
- `AdminModule` registers the controller/guard and imports what's needed for `AuditLogService`.

Every disable/enable action logs via `AuditLogService.log()`
(`server/src/audit/audit.service.ts`), action `admin.user_disabled` / `admin.user_enabled`, with
the target user's id/email in `metadata`, consistent with how other mutations audit-log at the
point of change.

## Client

- `client/src/pages/AdminUsersPage.tsx`, route `/admin/users`, wrapped in the existing
  `ProtectedRoute` + `Layout` like other authenticated pages.
- Nav link (in `Layout`) rendered only when `auth.user?.isAdmin`.
- Table: email, name, registered date, verified badge, disabled badge. Each row (except the
  admin's own) has a toggle/button: "Revoke access" when active, "Restore access" when disabled.
  Revoking asks for confirmation (destructive-ish, easy to undo but still access-affecting);
  restoring does not.
- The admin's own row shows no action control (self-lockout is also enforced server-side, but the
  UI shouldn't offer a button that always 400s).
- Uses the existing `api()` client helper for `GET`/`PATCH` calls, same pattern as other pages.

## Testing

- Server unit/e2e specs (`server/test/*.e2e.spec.ts` pattern): `AdminGuard` rejects non-admin
  users (403) and unauthenticated requests (401); `GET /api/admin/users` returns the expected
  shape; `PATCH .../:id` disables/enables and rejects self-target; disabled user's existing
  session is rejected on the next `AuthGuard`-protected call; disabled user can't start
  `login/options` or `recover`.
- Client: manual Playwright pass per `CLAUDE.md` — log in as the admin user, view the list,
  disable a non-admin user, confirm their session/login is rejected, re-enable, confirm login
  works again.

## Out of scope

- No roles/permissions system — single fixed admin via `ADMIN_EMAIL`.
- No cascading data deletion.
- No pagination/search on the user list.
- No audit-log viewer UI (out of scope for this feature; entries are still written).
