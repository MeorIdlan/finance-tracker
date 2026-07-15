# Commitment "already paid" + generalized payment source design

Date: 2026-07-15

## Context

Four related feature requests came out of a review of the commitments/credit-cards/transactions/loans domains:

1. A commitment added after the user has already paid it for the current period has no way to reflect that — every new commitment starts with `nextDueDate` set to the very next occurrence of `dueDayOfMonth`.
2. Credit cards can already be created with an opening `currentBalance` via the API (`CreateCreditCardDto.currentBalance`, optional, defaults to 0), but the client "Add Credit Card" form has no field for it, so it's unreachable from the UI.
3. Commitment payments and loan payments can only be sourced from a bank account today — `transactions.service.ts` hardcodes `accountId` as a bank-account reference for every `TransactionType` except `cardCharge`. There's no way to record "I paid this commitment/loan installment with my credit card."
4. `cardCharge` is a separate `TransactionType` from `expense`, with no `category` and no way to attribute it to a bank-account-style expense flow. The ask is to fold it into `expense` with a source picker (bank account vs credit card).

Items 3 and 4 are the same underlying gap — there is no concept of "payment source can be a bank account or a credit card" anywhere in the transaction model. This spec treats them as one change (**Thread B**). Item 1 is independent (**Thread A**). Item 2 is a small, uncontroversial client-only fix folded into Thread B's client work since it touches the same "Add Credit Card" form.

No production data exists yet (`cardCharge` and `accountId` rows), so this is a pure schema/code change with no migration step.

## Thread A: Commitment "already paid on creation"

**Goal**: let a user creating a commitment indicate they've already paid the current period, without recording a fabricated transaction (no real money-movement event is being tracked — it already happened before the app existed for this user).

**Changes**

- `CreateCommitmentDto` (shared + server DTO) gains an optional boolean field `alreadyPaidThisPeriod` (default `false`). It is accepted **only** on `create()`. `UpdateCommitmentDto` does not get this field — it is not meaningful after creation.
- `commitments.service.ts::create()`:
  1. Compute `nextDueDate = nextDueDateFrom(dto.dueDayOfMonth)` as today.
  2. If `dto.alreadyPaidThisPeriod` is true, advance it once more: `nextDueDate = shiftDueDate(nextDueDate, dto.dueDayOfMonth, 1)`.
  3. No `Transaction` is created. No bank account or credit card balance is touched.
- Client (`CommitmentsPage.tsx` or equivalent add-commitment form): a checkbox, "I've already paid this month," visible only on the creation form. Not shown on edit, not shown anywhere after creation (the commitment doc doesn't retain the flag — it's a one-time input to the due-date calculation).

## Thread B: Generalized payment source (bank account or credit card)

**Goal**: `expense`, `commitmentPayment`, and `loanPayment` transactions can be sourced from either a bank account or a credit card. `cardCharge` as a distinct type is eliminated — charging a card is just an `expense` (or `commitmentPayment`/`loanPayment`) with a credit-card source. Credit card creation also gets an opening-balance input in the UI.

### Schema changes (`Transaction`, `server/src/database/schemas/transaction.schema.ts`)

- Remove `accountId?: Types.ObjectId`.
- Add:
  - `sourceType: 'bankAccount' | 'creditCard'` — required on every type except plain `transfer`, where both ends are implicitly bank accounts.
  - `sourceId: Types.ObjectId` — replaces `accountId`; refers to a `BankAccount` or `CreditCard` depending on `sourceType`.
- `toAccountId` (transfer destination) is unchanged — still bank-account-only.
- `linkedEntityId` is unchanged in meaning (the commitment/loan/card being paid down or charged against) and is **not** used by plain `expense`.
- `shared/src/index.ts`: remove `'cardCharge'` from `TransactionType`, leaving `income | expense | commitmentPayment | loanPayment | cardPayment | transfer`. Add the `sourceType` union type. Update `TransactionDto`/`CreateTransactionDto` (`accountId` → `sourceType` + `sourceId`).

### Allowed source per type

| type | sourceType allowed | linkedEntityId |
|---|---|---|
| `income` | `bankAccount` only | — |
| `expense` | `bankAccount` or `creditCard` | — |
| `commitmentPayment` | `bankAccount` or `creditCard` | commitment |
| `loanPayment` | `bankAccount` or `creditCard` | loan |
| `cardPayment` | `bankAccount` only | credit card (target) |
| `transfer` | `bankAccount` only, both ends | — |

### Balance effects (`transactions.service.ts::applyEffect`)

- `sourceType: 'bankAccount'` → unchanged behavior: debit (or credit, for `income`) `sourceId`'s bank balance.
- `sourceType: 'creditCard'` (only reachable for `expense`/`commitmentPayment`/`loanPayment`) → `+amt` (scaled by `sign`) to that card's `currentBalance` only — `statementBalance` is untouched, exactly mirroring the old `cardCharge` effect and relying on the existing lazy rollover in `ensureStatementCurrent()`.
- Whatever `linkedEntityId` side effect already applies for `commitmentPayment` (`shiftDueDate` on the commitment) or `loanPayment` (decrement loan `currentBalance`) is independent of source and unchanged.
- `cardPayment` and `transfer` effects unchanged aside from the field rename.

### Validation (`transactions.service.ts::validateRefs`)

- Branch on `sourceType`:
  - `bankAccount` → `bankAccounts.mustOwn(sourceId)` (as today, was keyed off `accountId`).
  - `creditCard` → `creditCards.mustOwn(sourceId)`; only permitted when `type` is `expense`, `commitmentPayment`, or `loanPayment` — reject otherwise.
- `expense` continues to require `category` regardless of source.
- `cardPayment`/`transfer`/`income` continue to require/force `sourceType: 'bankAccount'`.

### Client changes

- Transaction form: for `expense`/`commitmentPayment`/`loanPayment`, add a source toggle (Bank Account / Credit Card) that swaps the account/card dropdown below it. For `income`/`cardPayment`/`transfer`, no toggle — bank account picker only, as today.
- `CreditCardsPage.tsx` add-card form: new optional "Opening balance" input, wired to the existing `currentBalance` field already accepted by `CreateCreditCardDto` on create. No schema change — `currentBalance` already exists and is mutable thereafter via transactions.
- Audit log formatting and the dashboard "recent transactions" list: account-name lookups need to branch on `sourceType` (look up bank account name vs credit card name).

### Out of scope

- `income` crediting a credit card (e.g. cashback/refunds) — not supported, bank account only.
- `cardPayment` sourced from another credit card (cash-advance style) — not supported, bank account only.
- Any migration of existing `cardCharge`/`accountId` data — no production data exists yet, so this is a clean-break schema change.

## Testing

- Server unit/e2e: `commitments.service.spec.ts` (alreadyPaidThisPeriod shifts nextDueDate correctly, including month-end clamping edge cases via `shiftDueDate`); `transactions.service.spec.ts`/e2e specs for each type × sourceType combination in the allowed-source table, plus rejection of disallowed combinations (e.g. `income` with `sourceType: 'creditCard'`, `cardPayment` with `sourceType: 'creditCard'`).
- Client: Playwright walkthrough of (a) adding a commitment with "already paid" checked and confirming `nextDueDate` on the list view, (b) adding a credit card with a nonzero opening balance and confirming it shows on the cards list, (c) adding an expense sourced from a credit card and confirming the card's balance updates and no bank account is affected, (d) adding a commitment payment sourced from a credit card.
