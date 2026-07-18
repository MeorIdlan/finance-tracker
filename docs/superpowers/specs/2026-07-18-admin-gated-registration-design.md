# Admin-Gated Registration — Design

**Date:** 2026-07-18
**Status:** Approved by user

## Problem

Registration is currently self-service: anyone who supplies an email receives their
own OTP and can complete the passkey ceremony. This app should instead be closed to
uninvited signups — modeled on how `tenderaggregator` gates its registration. The
registrant still requests registration with their own name + email, but the OTP is
never sent to them directly. It's emailed only to a fixed `ADMIN_EMAIL`, and a human
admin decides, out-of-band, whether to relay the code to the registrant.

Recovery (an already-verified user regaining access, e.g. after losing their passkey)
is unchanged — the OTP still goes to the account's own email, since that person already
proved themselves once via the admin-gated flow.

## Decisions made during brainstorming

- Registration OTP is **always** emailed to `ADMIN_EMAIL`, regardless of what email
  address is being registered. Never sent to the registrant.
- Recovery OTP **keeps going to the account's own email** — not gated through the
  admin, since recovery is for an already-approved account, not a new one.
- Registrant provides a **name** in addition to email, so the admin has enough context
  in the notification email to decide whether to relay the code.
- The OTP verification step itself (`POST /auth/verify-otp`) is unchanged — the
  registrant still enters the code themselves in their own browser session; only the
  *destination* of the OTP email changes.
- No RBAC/roles are introduced. This is purely about restricting who can complete
  registration, not about admin vs. member permissions within the app.

## Architecture & changes

**Config**: new required env var `ADMIN_EMAIL`, read via `ConfigService.getOrThrow`
(same pattern as `MAILGUN_API_KEY` etc. in `EmailService`). Added to `.env.example`.

**`User` schema** (`server/src/database/schemas/user.schema.ts`): add an optional
`name?: string` field (trimmed). Optional — so existing user documents created before
this change (which have no `name`) remain valid without a migration.

**DTOs** (`server/src/auth/dto.ts`): new `RegisterDto { name: string (non-empty),
email }` used only by `POST /auth/register`. The existing `EmailDto` continues to back
`POST /auth/recover` unchanged.

**`EmailService`** (`server/src/email/email.service.ts`): new method
`sendRegistrationRequestEmail(adminEmail, code, { name, email })`, separate from the
existing `sendOtpEmail(to, code)` (which recovery keeps using as-is). Subject/body
convey that this is a registration *request* awaiting the admin's approval to share,
e.g.:

> Subject: Finance Tracker registration request
> Body: "{name} <{email}> is requesting to register. Verification code: {code}. It
> expires in 10 minutes. Share it with them only if you want to approve this
> registration."

Same dev-mode console.log fallback and Mailgun send-limit pre-check as the existing
method.

**`AuthService.startRegistration(name, email)`** (`server/src/auth/auth.service.ts`):
signature changes from `(email)` to `(name, email)`. Sets/overwrites `user.name` on the
user document (covers both brand-new and re-requested-but-still-unverified users).
Calls `email.sendRegistrationRequestEmail(ADMIN_EMAIL, code, { name, email: normalized
})` instead of `sendOtpEmail(normalized, code)`. Audit log entry for
`auth.otp_requested` gains the registrant's name in its metadata for traceability.
`startRecovery` is untouched.

**`AuthController.register`** (`server/src/auth/auth.controller.ts`): accepts
`RegisterDto` instead of `EmailDto`, passes `dto.name, dto.email` to
`auth.startRegistration`. The existing `EmailKeyThrottlerGuard` + `Throttle` decorator
(5/hour, IP+email keyed) is unchanged — it already rate-limits by the registrant's
supplied email, which still makes sense as the throttle key even though the email now
goes elsewhere.

**Frontend `RegisterPage.tsx`** (`client/src/pages/RegisterPage.tsx`): add a required
"Name" text input above the email field; submit `{ name, email }` to `POST
/auth/register`. Copy update: replace "Send verification code" messaging/context so
the user understands the code goes to the site admin, not their own inbox — e.g. helper
text under the form: "An admin will review your request and share a verification code
with you if approved."

**Docs**: update `docs/deployment.md`'s env var checklist (add `ADMIN_EMAIL`) and the
smoke-test line "Register a new account: OTP email arrives..." to reflect that the OTP
now arrives in the admin's inbox, not the registrant's, and must be manually relayed
before continuing the smoke test.

## Error handling & security

- Missing `ADMIN_EMAIL` config → app fails to start (`getOrThrow`), same fail-fast
  pattern as the other required Mailgun env vars.
- Mailgun send-limit exceeded while notifying the admin → same `503` from
  `sendRegistrationRequestEmail` as today's `sendOtpEmail`, surfaced to the registrant
  as "Monthly email quota reached."
- Rate limiting on `/auth/register` is unchanged (5/hour per IP+email composite key via
  `EmailKeyThrottlerGuard`) — still guards against spamming the admin's inbox with
  requests.
- OTP verification, expiry (10 min), and attempt-limiting (5 tries, in `OtpService`) are
  entirely unchanged — only the email's destination and the added `name` context
  change.
- No behavior changes to login, session handling, or the passkey ceremony.

## Testing

- `server/src/email/email.service.spec.ts`: add coverage for
  `sendRegistrationRequestEmail` (sends to `ADMIN_EMAIL`, includes name/email/code in
  body, respects the same send-limit precheck and fail-open behavior as
  `sendOtpEmail`).
- `server/src/auth/auth.service.spec.ts` (or equivalent, if present) /
  `auth.controller` tests: assert `startRegistration` calls the new email method with
  `ADMIN_EMAIL` as recipient (not the registrant's address), and that `startRecovery`
  still calls `sendOtpEmail` with the account's own address.
- Existing e2e register flow tests updated to reflect the OTP being captured from the
  admin-routed email/dev-log rather than the registrant's.
