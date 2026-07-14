# UI Redesign — Design Spec

**Date:** 2026-07-14
**Status:** Approved for planning

## 1. Overview

The client (`client/`) currently has no styling system at all — no CSS files,
no design tokens, bare semantic HTML with a handful of inline styles on the
dashboard only. This spec redesigns the entire client UI from scratch: a
dense, dark, data-forward visual direction ("Direction C" from brainstorming),
built with Tailwind CSS and design tokens seeded from the existing validated
chart palette in `client/src/viz/theme.ts`.

This is a **client-only, visual/markup change**. No API routes, DTOs, shared
types, or business logic change. Full responsive/mobile support is in scope.

## 2. Visual direction

Dense, dark, fintech/terminal-inspired. Reference mockup: sidebar nav, dark
surfaces (`#16161a` background / `#1a1a19` panels / `#2c2c2f` borders), sharp
small-radius cards, tabular monospace figures for money and dates, sans-serif
for everything else. RM currency is always explicit wherever money appears
(stat tiles, tables, bills, forms) — never a bare number.

Dark-only: no light theme, no `prefers-color-scheme` toggle anywhere in the
app, including charts.

## 3. Design tokens & tech setup

- **Tailwind CSS** added as a dev dependency to `client/`, with
  `tailwind.config.ts` extending the default theme with custom tokens (not
  using Tailwind's stock palette):
  - `bg` `#16161a` (app background)
  - `surface` `#1a1a19` (panels, cards, drawer)
  - `surface-raised` a slightly lighter shade for nested/hover surfaces
  - `border` `#2c2c2f`
  - `muted` `#6b6b6f` (secondary text, labels)
  - `ink` `#e8e8e6` (body text), `#ffffff` for emphasis (stat values, headings)
  - `accent` `#3987e5` (primary interactive color — links, primary buttons,
    focus rings, active nav state)
  - `series-1`…`series-8` — the 8 chart series colors from `viz/theme.ts`
    `DARK.series`, exposed as named Tailwind colors so chart legends, category
    badges, and any UI color-coding share one source of truth with charts.
  - Semantic status colors: `danger` (`#e66767`, overdue/destructive),
    `warning` (`#c98500`, due-soon), `success` (`#199e70`, positive amounts).
- **`viz/theme.ts` simplified to dark-only**: `vizTheme()` always returns the
  existing `DARK` palette; the `LIGHT` constant and the
  `prefers-color-scheme` branch are removed. `categoryColor()` is unchanged.
- **Typography**: two font stacks.
  - `font-sans` (system UI stack: `-apple-system, "Segoe UI", Roboto, sans-serif`)
    for nav, labels, buttons, form fields, body text, error messages.
  - `font-mono` (`ui-monospace, "SF Mono", Menlo, monospace`) applied via a
    `.tabular` utility (or Tailwind `font-mono tabular-nums`) specifically to
    money and date figures in stat tiles, tables, and chart tooltips — not the
    whole page. (The brainstorm mockup used monospace page-wide; full-page
    monospace hurt readability of prose like form labels and error text, so
    it's scoped to numeric figures only.)
- **Global stylesheet**: `client/src/index.css` — Tailwind's `@tailwind base;
  @tailwind components; @tailwind utilities;` plus a minimal reset (box-sizing,
  margin reset, `background: theme(bg)` on `html`/`body`). Imported once in
  `main.tsx`.

## 4. App shell & layout (`Layout.tsx`)

- **Desktop (≥768px)**: fixed left sidebar, ~220px wide, `bg-surface` with a
  right border. Top of sidebar: app name. Middle: 7 nav items (Dashboard,
  Transactions, Accounts, Commitments, Loans, Credit Cards, Settings) as a
  vertical list; active item gets a left accent border + white text, inactive
  items are `muted`. Bottom of sidebar: user email (truncated) + a logout
  button.
- **Page content area**: to the right of the sidebar, `bg-bg`. Each page gets
  a consistent header row: page title (left) + a primary action button when
  applicable (right, e.g. "+ Add transaction"). This replaces today's bare
  `<h1>` per page.
- **Mobile (<768px)**: sidebar becomes a slide-out drawer (backdrop + panel,
  same nav items) triggered by a hamburger button in a new top strip that
  replaces the sidebar. Additionally, a persistent bottom tab bar shows
  Dashboard / Transactions / Accounts + a "More" tab that opens the drawer
  for the remaining 4 destinations — chosen over hamburger-only navigation
  because this is an app people check daily and a fully hidden nav is easy to
  miss.
- **Responsive content**: stat tile rows (dashboard) stack full-width below
  `md`; the dashboard's `repeat(auto-fit, minmax(320px,1fr))` card grid
  collapses to a single column below `md`.

## 5. Component inventory

New shared components under `client/src/components/`:

- **`Button`** — `variant`: `primary` (filled accent, e.g. Add/Save),
  `secondary` (outline/ghost, e.g. Cancel), `destructive` (red text/outline,
  e.g. Delete). Used everywhere a `<button>` currently appears bare.
- **`Input`** / **`Select`** — dark bordered field, accent-color focus ring,
  error state (red border) that existing `role="alert"` validation messages
  pair with.
- **`Badge`** — small colored pill for status/type labels: bill status
  (`OVERDUE` → `danger`, `Due soon` → `warning`, `Upcoming` → `muted`),
  transaction type, savings vs investment type.
- **`Drawer`** — slides in from the right, backdrop, closes on save / cancel /
  Esc / backdrop click. The single reusable container for every create/edit
  form across all 5 entity types (bank accounts, savings accounts,
  commitments, loans, credit cards, transactions), replacing both the
  always-visible inline `<form>` blocks and the `window.prompt()`-based edit
  flow in `TransactionsPage.tsx` / `AccountsPage.tsx`. The savings snapshot
  history sub-view becomes a nested section within the savings account's
  drawer.
- **`Table`** (or plain styled `<table>` conventions) — dense rows,
  `.tabular` monospace for money/date columns, per-row Edit/Delete as small
  icon buttons instead of inline text buttons.
- **`Pagination`** — compact `‹ Page 2 of 5 ›` control for the Transactions
  list, replacing the current bare Prev/Next buttons + text.
- **`ChartCard`** (existing, restyled) — `bg-surface` panel with `border`,
  consistent padding/title treatment; Chart.js options already read from
  `vizTheme()` so charts inherit the dark palette once section 3 lands.
- **Auth card** — centered ~400px card on `bg-bg`, used by Login, Register,
  Recover, VerifyOtp, and the passkey-setup step. No sidebar on these routes.
  Uses the same `Button`/`Input` components as the rest of the app.

## 6. Page-by-page notes

- **Dashboard**: stat tile row + chart card grid as today, restyled with the
  new tokens/components; no widget changes.
- **Transactions**: "+ Add transaction" opens the Drawer with today's form
  fields, unchanged conditional field logic (`needsAccount`/`needsCategory`/
  `needsToAccount`/`linkedOptions`). Table gets `Badge` for type,
  icon Edit/Delete actions opening the Drawer (edit) or a confirm (delete).
  Type filter becomes a styled `Select`. `Pagination` component.
- **Accounts**: bank accounts and savings/investments each get their own
  "+ Add" → Drawer flow; rename/recompute/delete become icon actions on the
  list. Snapshot history nested in the savings account's Drawer.
- **Commitments / Loans / Credit Cards**: same list + "+ Add" → Drawer
  pattern, applied consistently (current implementations are structurally
  similar to Accounts).
- **Settings**: Passkeys list + "Add a passkey" action restyled with
  `Button`/`Badge`; recent activity (audit log) as a styled list with
  monospace timestamps.

## 7. Out of scope

- No new API routes, DTO changes, or `shared/` changes.
- No new features, charts, or widgets.
- No light theme / theme toggle.
- No dedicated accessibility audit beyond what naturally follows from using
  real form/button semantics (already present in the current markup).
- No new automated component tests — this is a markup/styling change with no
  existing page-level test coverage to extend; verification is manual
  (dev server + browser) per page during implementation. `money.spec.ts` and
  `api.spec.ts` are unaffected since no logic changes.

## 8. Implementation phase order

1. Tailwind setup + design tokens + `index.css` + `viz/theme.ts` dark-only
   simplification.
2. Shared components: `Button`, `Input`, `Select`, `Badge`, `Drawer`,
   `Pagination`, restyled `ChartCard`.
3. `Layout.tsx` shell: sidebar (desktop) + drawer/bottom-tab nav (mobile).
4. Auth pages: Login, Register, Recover, VerifyOtp, Passkey setup.
5. Dashboard.
6. CRUD pages: Transactions, Accounts, Commitments, Loans, Credit Cards.
7. Settings.
