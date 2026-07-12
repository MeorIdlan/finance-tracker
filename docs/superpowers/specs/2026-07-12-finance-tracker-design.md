# Personal Finance Tracker — Design Spec

**Date:** 2026-07-12
**Status:** Approved for planning

## 1. Overview

A self-hosted, multi-user web app for tracking personal finances: bank accounts,
commitments (recurring bills), loans, credit cards, savings/investment accounts,
and transactions. Users log in passwordlessly via WebAuthn passkeys. The
dashboard surfaces net worth, spending, and upcoming obligations through charts.

Single currency: **MYR**. No multi-currency support in v1.

## 2. Architecture

- **Monorepo**: `/server` (NestJS + TypeScript API), `/client` (React + Vite +
  TypeScript), `/shared` (TypeScript types/interfaces for core entities used by
  both sides), root `docker-compose.yml`.
- **Backend framework**: NestJS, organized into modules per domain (auth,
  passkeys, accounts, transactions, commitments, loans, credit-cards,
  dashboard, audit-log). Uses Nest's guards for session auth and
  class-validator DTOs for request validation.
- **Frontend**: React + Vite, Chart.js for graphs/charts.
- **Database**: MongoDB, single instance, via docker-compose with a named
  volume for persistence.
- **Communication**: Frontend calls backend via REST under `/api/...`. Served
  same-origin in production (client and server behind the same domain) so
  `httpOnly` session cookies work without CORS complications.
- **Sessions**: Server-side sessions stored in a MongoDB `sessions` collection.
  The browser holds only a session ID in an `httpOnly`, `Secure`,
  `SameSite=Lax` cookie.
- **Deployment**: DigitalOcean droplet running the docker-compose stack. Three
  services: `server` (NestJS API), `client` (nginx container serving the
  built React static assets and reverse-proxying `/api` to `server`),
  `mongodb`.
  Cloudflare Tunnel (`cloudflared`) connects the droplet to a Cloudflare-managed
  domain, terminating HTTPS at Cloudflare's edge. This satisfies WebAuthn's
  secure-context requirement; the WebAuthn Relying Party ID is set to the
  domain.
- **Configuration**: Secrets (MongoDB URI, MailerSend API key, session secret,
  WebAuthn RP ID/origin) live in a non-committed `.env` file.

## 3. Authentication

### 3.1 Registration

1. User submits their email.
2. Server generates a 6-digit OTP, stores a hashed version with a ~10 minute
   expiry (`OtpCode`, purpose=`register`), and sends it via MailerSend.
3. User enters the OTP on a confirmation page. Server verifies it, marks the
   `User.emailVerified`, and issues a short-lived registration token.
4. User is prompted to register a passkey via `navigator.credentials.create`.
   Server stores the resulting credential (`Credential`: credentialId,
   publicKey, counter, deviceLabel) linked to the new user.
5. Server creates a session, sets the httpOnly cookie, and the user lands on
   the dashboard.

### 3.2 Login

1. User submits their email.
2. Server looks up the user's registered credentials and returns WebAuthn
   assertion options.
3. Browser prompts for a passkey via `navigator.credentials.get`.
4. Server verifies the assertion, creates a session, sets the cookie.

### 3.3 Account Recovery

If a user loses access to all registered passkeys:

1. Same email + OTP flow as registration (purpose=`recovery`), but for an
   already-verified user. On success, a temporary authenticated session is
   issued.
2. User is prompted to register a new passkey, which is added alongside any
   still-valid credentials.

### 3.4 Passkey Management

A settings page lists a user's registered passkeys (device label, date added)
and allows adding new ones or removing old ones.

### 3.5 Email Quota Tracking

MailerSend's free tier has a limited monthly send quota. An
`EmailQuotaUsage` collection (keyed by year-month) increments on every send.
Before sending, the server checks projected usage against the quota; if it
would be exceeded, the send is blocked and the user sees a clear error instead
of a silent failure or an opaque MailerSend API error.

## 4. Data Model (MongoDB collections)

- **User**: `email`, `emailVerified`, `createdAt`
- **Credential**: `userId`, `credentialId`, `publicKey`, `counter`,
  `deviceLabel`, `createdAt`
- **OtpCode**: `userId`/`email`, `codeHash`, `purpose` (`register` |
  `recovery`), `expiresAt`, `consumedAt`
- **Session**: `userId`, `expiresAt`, `createdAt`
- **EmailQuotaUsage**: `yearMonth`, `count`
- **BankAccount**: `userId`, `name`, `openingBalance`, `currentBalance`,
  `createdAt`. `currentBalance` is a stored field, initialized to
  `openingBalance` and updated atomically (within the same DB transaction) by
  every transaction create/edit/delete that affects the account — not
  recomputed from history on each read. A "recompute from transaction
  history" repair action (exposed via the `accounts` API and used if drift is
  ever suspected) recalculates and overwrites `currentBalance` from scratch as
  a safety net. Reconciliation against a real bank is done by adding an
  adjustment transaction.
- **SavingsInvestmentAccount**: `userId`, `name`, `type` (`savings` |
  `investment`), `createdAt`
- **ValueSnapshot**: `accountId`, `date`, `value` — periodic manual entries
  logging an investment/savings account's value over time, powering a growth
  chart.
- **Commitment**: `userId`, `name`, `amount`, `recurrenceRule` (e.g. monthly
  on day N), `nextDueDate`, `active`. Due dates are auto-generated from the
  recurrence rule; paying a commitment via a transaction advances
  `nextDueDate` and updates its paid/overdue status.
- **Loan**: `userId`, `name`, `principal`, `interestRate` (stored for
  reference only, not used in amortization calculations in v1),
  `currentBalance`, `startDate`. Balance decreases only as payments are
  logged; no amortization schedule is calculated in v1.
- **CreditCard**: `userId`, `name`, `creditLimit`, `statementBalance`,
  `currentBalance`, `statementDay`, `dueDay`
- **Transaction**: `userId`, `type` (`income` | `expense` |
  `commitmentPayment` | `loanPayment` | `cardPayment` | `cardCharge` |
  `transfer`), `amount`, `date`, `category` (for `expense` type only),
  `accountId` (bank account affected), `linkedEntityId` (commitment/loan/card,
  when applicable), `toAccountId` (for `transfer` type only), `note`
- **AuditLog**: `userId`, `action`, `entityType`, `entityId`, `metadata`
  (details/diff), `timestamp`. Captures both financial data mutations
  (create/update/delete on transactions and all financial entities) and auth
  events (logins, passkey add/remove, OTP requests).

Each transaction, on creation, atomically updates the balance/status of
whatever it's linked to: the bank account's stored `currentBalance`, a
commitment's due status, a loan's outstanding balance, or a credit card's
balance. Edits and deletes of existing transactions must likewise reverse and
reapply the balance effect atomically.

### 4.1 Expense Categories

Discretionary expense transactions use a predefined category list (e.g. Food,
Transport, Entertainment, Bills, Shopping, Health, Other) to power the
dashboard's spending-by-category chart. Categories are defined as a
TypeScript const/enum in `/shared` (not a database collection) so client and
server import the same source of truth; `Transaction.category` stores the
value directly. No per-user customization in v1.

## 5. Pages

- `/register`, `/register/verify`, `/register/passkey` — registration flow
- `/login` — email + passkey login
- `/recover` — OTP-based recovery flow
- `/dashboard` — overview widgets (see Section 7)
- `/transactions` — historical list (filter/search/paginate) + add transaction
- `/accounts` — bank accounts and savings/investment accounts, CRUD
- `/commitments` — list with status (upcoming/overdue/paid), CRUD
- `/loans` — list with balances, CRUD
- `/credit-cards` — list with statement/current balance, CRUD
- `/settings` — passkey management, account info, audit log view

## 6. API Surface (NestJS modules, REST under `/api`)

- `auth` — register, verify-otp, login (options/verify), recover, logout
- `passkeys` — list, add, remove
- `accounts` — bank + savings/investment CRUD, value snapshots, balance
  recompute (repair action for `currentBalance` drift)
- `transactions` — CRUD, list with filters
- `commitments`, `loans`, `credit-cards` — CRUD
- `dashboard` — aggregated endpoints for widget data (net worth, category
  breakdown, trends, upcoming bills)
- `audit-log` — read-only, paginated

## 7. Dashboard Widgets

1. **Net worth summary** — total assets minus liabilities, with a trend line
   over time.
2. **Account balances breakdown** — bank + savings/investment accounts, as a
   donut or bar chart.
3. **Upcoming bills** — commitments/loans/credit cards due in the next 7-14
   days.
4. **Spending by category** (current month) — pie/donut chart.
5. **Spending trend over time** — line/bar chart of monthly totals.
6. **Debt overview** — total outstanding across loans + credit cards, with a
   payoff trend.
7. **Recent transactions** — last 5-10, linking to the full transaction
   history.

## 8. Out of Scope (v1)

- Multi-currency support.
- Email reminders for upcoming bills (dashboard widget covers this for now).
- Loan amortization schedules (principal/interest split, projected payoff
  tables).
- Credit card interest calculations.

## 9. Open Questions for Implementation Planning

None — all sections above were reviewed and approved during design.
