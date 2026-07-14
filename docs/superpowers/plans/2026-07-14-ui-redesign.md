# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire `client/` UI from bare unstyled HTML to a dense, dark, fintech-style design system built on Tailwind CSS, with zero backend/API/shared-type changes.

**Architecture:** Tailwind CSS with custom design tokens (colors/fonts) seeded from the existing validated chart palette in `client/src/viz/theme.ts`. A small shared component library (`client/src/components/`) is built first, then the app shell (`Layout.tsx`), then every page is rewritten in place to use the new components and Tailwind classes. No new routes, no new API calls, no changes to `client/src/api.ts`, `client/src/money.ts`, `client/src/auth-context.tsx`, or `shared/`.

**Tech Stack:** Tailwind CSS 3.x + PostCSS + Autoprefixer (new devDependencies), React 19, Vite 7, TypeScript 5.7 (all existing).

## Global Constraints

- Dark-only. No light theme, no `prefers-color-scheme` branching anywhere (this removes the existing branch in `viz/theme.ts`).
- RM currency must always be explicit wherever money is displayed — never a bare number. `formatSen()` (`client/src/money.ts`, unchanged) already returns `"RM 1,234.00"` style strings; every display of a monetary value must go through it.
- Color tokens: `bg` `#16161a`, `surface` `#1a1a19`, `surface-raised` `#232327`, `border` `#2c2c2f`, `muted` `#6b6b6f`, `ink` `#e8e8e6`, `accent` `#3987e5`, `danger` `#e66767`, `warning` `#c98500`, `success` `#199e70`, `series-1`..`series-8` matching `viz/theme.ts`'s `DARK.series` array exactly (`#3987e5`, `#199e70`, `#c98500`, `#008300`, `#9085e9`, `#e66767`, `#d55181`, `#d95926`).
- Two font stacks: `font-sans` (system UI) for everything except monetary/date figures, `font-mono` + `tabular-nums` reserved for those figures only.
- No new automated component tests (per spec section 7) — this is a markup/styling-only change with no existing page-level test coverage. Each task's verification is: (a) `npm run build --workspace client` must succeed (typecheck + build), and (b) a manual visual check by running `npm run dev --workspace client` and viewing the affected page(s) in a browser. `money.spec.ts` and `api.spec.ts` must continue to pass unmodified (run `npm test --workspace client` after Task 1 and again at the end to confirm no regression).
- No new dependencies beyond Tailwind/PostCSS/Autoprefixer — "icon buttons" are implemented as small hand-written inline SVGs, not an icon library.
- Follow existing code conventions: named default exports per component file, `@finance/shared` types imported where DTOs are used, `api()`/`ApiError` from `client/src/api.ts` unchanged.

---

### Task 1: Tailwind setup, design tokens, dark-only chart theme

**Files:**
- Modify: `client/package.json`
- Create: `client/tailwind.config.ts`
- Create: `client/postcss.config.js`
- Create: `client/src/index.css`
- Modify: `client/src/main.tsx`
- Modify: `client/src/viz/theme.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: Tailwind utility classes (`bg-bg`, `bg-surface`, `bg-surface-raised`, `border-border`, `text-muted`, `text-ink`, `text-accent`, `text-danger`, `text-warning`, `text-success`, `bg-series-1`..`bg-series-8`/`text-series-1`..`text-series-8`, `font-sans`, `font-mono`) available to every subsequent task. `vizTheme()` from `client/src/viz/theme.ts` now always returns the dark palette (no `LIGHT` export, no argument).

- [ ] **Step 1: Add Tailwind/PostCSS devDependencies**

Edit `client/package.json`, add to `devDependencies` (keep existing entries):

```json
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.15",
```

Run:
```bash
npm install --workspace client
```

- [ ] **Step 2: Create Tailwind config with design tokens**

Create `client/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#16161a',
        surface: '#1a1a19',
        'surface-raised': '#232327',
        border: '#2c2c2f',
        muted: '#6b6b6f',
        ink: '#e8e8e6',
        accent: '#3987e5',
        danger: '#e66767',
        warning: '#c98500',
        success: '#199e70',
        series: {
          1: '#3987e5',
          2: '#199e70',
          3: '#c98500',
          4: '#008300',
          5: '#9085e9',
          6: '#e66767',
          7: '#d55181',
          8: '#d95926',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3: Create PostCSS config**

Create `client/postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Create global stylesheet**

Create `client/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
}

body {
  @apply bg-bg font-sans text-ink antialiased;
}
```

- [ ] **Step 5: Import the stylesheet**

Edit `client/src/main.tsx`, add the import as the first line:

```tsx
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
```

- [ ] **Step 6: Simplify `viz/theme.ts` to dark-only**

Replace the full contents of `client/src/viz/theme.ts`:

```ts
import { EXPENSE_CATEGORIES, ExpenseCategory } from '@finance/shared';

export interface VizTheme {
  surface: string;
  ink: string;
  inkSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  series: string[];
}

// Validated palette (CVD-safe in this slot order — never reorder or cycle).
const DARK: VizTheme = {
  surface: '#1a1a19',
  ink: '#ffffff',
  inkSecondary: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
  series: [
    '#3987e5',
    '#199e70',
    '#c98500',
    '#008300',
    '#9085e9',
    '#e66767',
    '#d55181',
    '#d95926',
  ],
};

export function vizTheme(): VizTheme {
  return DARK;
}

// Category identity is stable: EXPENSE_CATEGORIES index -> series slot.
export function categoryColor(
  category: ExpenseCategory,
  theme: VizTheme,
): string {
  const idx = EXPENSE_CATEGORIES.indexOf(category);
  return theme.series[idx % theme.series.length];
}
```

- [ ] **Step 7: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds with no TypeScript errors.

Run: `npm test --workspace client`
Expected: `money.spec.ts` and `api.spec.ts` pass unchanged.

- [ ] **Step 8: Commit**

```bash
git add client/package.json client/package-lock.json client/tailwind.config.ts client/postcss.config.js client/src/index.css client/src/main.tsx client/src/viz/theme.ts
git commit -m "feat(client): add Tailwind design tokens, dark-only chart theme"
```

---

### Task 2: Shared form/action components (Button, Input, Select, Badge, icons)

**Files:**
- Create: `client/src/components/Button.tsx`
- Create: `client/src/components/Input.tsx`
- Create: `client/src/components/Select.tsx`
- Create: `client/src/components/Badge.tsx`
- Create: `client/src/components/icons.tsx`
- Create: `client/src/components/IconButton.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1 (`bg-accent`, `text-danger`, `border-border`, etc.).
- Produces:
  - `Button` (default export, `client/src/components/Button.tsx`): props `variant?: 'primary' | 'secondary' | 'destructive'` (default `'primary'`) plus all standard `<button>` props.
  - `Input` (default export, `client/src/components/Input.tsx`): props `label?: string` plus all standard `<input>` props; when `label` is set, wraps in a `<label>` — callers must pass `id`.
  - `Select` (default export, `client/src/components/Select.tsx`): same pattern as `Input` for `<select>`, children are `<option>` elements.
  - `Badge` (default export, `client/src/components/Badge.tsx`): props `tone?: 'muted' | 'danger' | 'warning' | 'success' | 'accent'` (default `'muted'`), `children: ReactNode`.
  - `EditIcon`, `TrashIcon` (named exports, `client/src/components/icons.tsx`): no props, render a 14x14 `<svg>`.
  - `IconButton` (default export, `client/src/components/IconButton.tsx`): props `variant?: 'default' | 'destructive'` (default `'default'`), `label: string` (used for `aria-label`/`title`), plus standard `<button>` props; `children` is the icon element.

- [ ] **Step 1: Create `Button`**

Create `client/src/components/Button.tsx`:

```tsx
import { ButtonHTMLAttributes, forwardRef } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'destructive';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent/90 disabled:bg-accent/40',
  secondary:
    'border border-border text-ink hover:bg-surface-raised disabled:opacity-40',
  destructive:
    'text-danger border border-danger/40 hover:bg-danger/10 disabled:opacity-40',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', className = '', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
});

export default Button;
```

- [ ] **Step 2: Create `Input`**

Create `client/src/components/Input.tsx`:

```tsx
import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, id, className = '', ...props },
  ref,
) {
  const input = (
    <input
      ref={ref}
      id={id}
      className={`w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    />
  );
  if (!label) return input;
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {input}
    </label>
  );
});

export default Input;
```

- [ ] **Step 3: Create `Select`**

Create `client/src/components/Select.tsx`:

```tsx
import { SelectHTMLAttributes, forwardRef } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, id, className = '', children, ...props },
  ref,
) {
  const select = (
    <select
      ref={ref}
      id={id}
      className={`w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    >
      {children}
    </select>
  );
  if (!label) return select;
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {select}
    </label>
  );
});

export default Select;
```

- [ ] **Step 4: Create `Badge`**

Create `client/src/components/Badge.tsx`:

```tsx
import { ReactNode } from 'react';

type BadgeTone = 'muted' | 'danger' | 'warning' | 'success' | 'accent';

const TONE_CLASSES: Record<BadgeTone, string> = {
  muted: 'bg-surface-raised text-muted',
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
  success: 'bg-success/15 text-success',
  accent: 'bg-accent/15 text-accent',
};

export default function Badge({
  tone = 'muted',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 5: Create icon SVGs and `IconButton`**

Create `client/src/components/icons.tsx`:

```tsx
export function EditIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
```

Create `client/src/components/IconButton.tsx`:

```tsx
import { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive';
  label: string;
  children: ReactNode;
}

export default function IconButton({
  variant = 'default',
  label,
  className = '',
  children,
  ...props
}: IconButtonProps) {
  const color =
    variant === 'destructive'
      ? 'text-danger hover:bg-danger/10'
      : 'text-muted hover:text-ink hover:bg-surface-raised';
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${color} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 6: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds (these components aren't imported anywhere yet, so this just checks they compile standalone — `tsc -b` will still type-check unused files under `src/`).

- [ ] **Step 7: Commit**

```bash
git add client/src/components/Button.tsx client/src/components/Input.tsx client/src/components/Select.tsx client/src/components/Badge.tsx client/src/components/icons.tsx client/src/components/IconButton.tsx
git commit -m "feat(client): add Button, Input, Select, Badge, IconButton components"
```

---

### Task 3: Drawer, Pagination, AuthCard, restyled ChartCard

**Files:**
- Create: `client/src/components/Drawer.tsx`
- Create: `client/src/components/Pagination.tsx`
- Create: `client/src/components/AuthCard.tsx`
- Modify: `client/src/viz/ChartCard.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1.
- Produces:
  - `Drawer` (default export, `client/src/components/Drawer.tsx`): props `open: boolean`, `title: string`, `onClose: () => void`, `children: ReactNode`. Renders `null` when `open` is `false`. Closes on Escape key, backdrop click, or the close (`✕`) button.
  - `Pagination` (default export, `client/src/components/Pagination.tsx`): props `page: number`, `pageCount: number`, `onChange: (page: number) => void`.
  - `AuthCard` (default export, `client/src/components/AuthCard.tsx`): props `title: string`, `children: ReactNode`. Renders a full-page centered card on `bg-bg`.
  - `ChartCard` (default export, `client/src/viz/ChartCard.tsx`, unchanged signature: `title: string`, `children: ReactNode`) now uses Tailwind classes instead of inline styles.

- [ ] **Step 1: Create `Drawer`**

Create `client/src/components/Drawer.tsx`:

```tsx
import { ReactNode, useEffect } from 'react';

export default function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-50 flex h-full w-full max-w-sm flex-col overflow-y-auto border-l border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `Pagination`**

Create `client/src/components/Pagination.tsx`:

```tsx
export default function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded border border-border px-2 py-1 disabled:opacity-30"
      >
        ‹
      </button>
      <span className="font-mono tabular-nums">
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
        className="rounded border border-border px-2 py-1 disabled:opacity-30"
      >
        ›
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create `AuthCard`**

Create `client/src/components/AuthCard.tsx`:

```tsx
import { ReactNode } from 'react';

export default function AuthCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <h1 className="mb-4 text-lg font-semibold text-ink">{title}</h1>
        {children}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Restyle `ChartCard`**

Replace the full contents of `client/src/viz/ChartCard.tsx`:

```tsx
import { ReactNode } from 'react';

export default function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
        {title}
      </h2>
      <div className="relative h-56">{children}</div>
    </section>
  );
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Drawer.tsx client/src/components/Pagination.tsx client/src/components/AuthCard.tsx client/src/viz/ChartCard.tsx
git commit -m "feat(client): add Drawer, Pagination, AuthCard; restyle ChartCard"
```

---

### Task 4: App shell — sidebar nav + mobile drawer/bottom tabs (`Layout.tsx`)

**Files:**
- Modify: `client/src/Layout.tsx`

**Interfaces:**
- Consumes: `useAuth` from `client/src/auth-context.tsx` (unchanged), `api` from `client/src/api.ts` (unchanged).
- Produces: `Layout` default export signature unchanged (`{ children: ReactNode }`), still wraps every protected route in `App.tsx` exactly as today — no changes needed in `App.tsx`.

- [ ] **Step 1: Rewrite `Layout.tsx`**

Replace the full contents of `client/src/Layout.tsx`:

```tsx
import { ReactNode, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth-context';

const LINKS = [
  ['/dashboard', 'Dashboard'],
  ['/transactions', 'Transactions'],
  ['/accounts', 'Accounts'],
  ['/commitments', 'Commitments'],
  ['/loans', 'Loans'],
  ['/credit-cards', 'Credit Cards'],
  ['/settings', 'Settings'],
] as const;

const BOTTOM_LINKS = LINKS.slice(0, 3);

function navItemClass({ isActive }: { isActive: boolean }) {
  return `block rounded-md px-3 py-2 text-sm ${
    isActive
      ? 'border-l-2 border-accent bg-surface-raised pl-[10px] text-white'
      : 'text-muted hover:bg-surface-raised hover:text-ink'
  }`;
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    await refresh();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen bg-bg text-ink">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 flex-shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="px-4 py-4 text-sm font-semibold">Finance Tracker</div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {LINKS.map(([to, label]) => (
            <NavLink key={to} to={to} className={navItemClass}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border px-4 py-3">
          <div className="truncate text-xs text-muted">{user?.email}</div>
          <button onClick={logout} className="mt-2 text-xs text-muted hover:text-ink">
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile top strip */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <span className="text-sm font-semibold">Finance Tracker</span>
        <button aria-label="Open menu" onClick={() => setDrawerOpen(true)} className="text-ink">
          ☰
        </button>
      </div>

      {/* Mobile drawer nav */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-50 flex h-full w-64 flex-col bg-surface p-4">
            <nav className="flex flex-1 flex-col gap-1">
              {LINKS.map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  className={navItemClass}
                  onClick={() => setDrawerOpen(false)}
                >
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="border-t border-border pt-3">
              <div className="truncate text-xs text-muted">{user?.email}</div>
              <button onClick={logout} className="mt-2 text-xs text-muted hover:text-ink">
                Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface md:hidden">
        {BOTTOM_LINKS.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 py-2 text-center text-[11px] ${isActive ? 'text-accent' : 'text-muted'}`
            }
          >
            {label}
          </NavLink>
        ))}
        <button onClick={() => setDrawerOpen(true)} className="flex-1 py-2 text-center text-[11px] text-muted">
          More
        </button>
      </nav>

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-20 pt-16 md:px-8 md:py-8 md:pb-8 md:pt-8">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds.

- [ ] **Step 3: Manual visual check**

Run: `npm run start:dev --workspace server` (in one terminal) and `npm run dev --workspace client` (in another), log in, and confirm: sidebar shows on desktop width with all 7 links and correct active-state highlighting; resizing below 768px hides the sidebar and shows the top strip + bottom tab bar; tapping "More" or the hamburger opens the drawer with all 7 links; logout works.

- [ ] **Step 4: Commit**

```bash
git add client/src/Layout.tsx
git commit -m "feat(client): rebuild app shell with sidebar nav and mobile drawer/bottom tabs"
```

---

### Task 5: Auth pages (Login, Register, Recover, VerifyOtp, Passkey setup)

**Files:**
- Modify: `client/src/pages/LoginPage.tsx`
- Modify: `client/src/pages/RegisterPage.tsx`
- Modify: `client/src/pages/RecoverPage.tsx`
- Modify: `client/src/pages/VerifyOtpPage.tsx`
- Modify: `client/src/pages/PasskeyPage.tsx`

**Interfaces:**
- Consumes: `AuthCard`, `Button`, `Input` (Tasks 2–3); `api`, `ApiError` (`client/src/api.ts`, unchanged); `useAuth` (`client/src/auth-context.tsx`, unchanged).
- Produces: no exports consumed by later tasks — these are leaf route components (see `App.tsx`, unchanged).

- [ ] **Step 1: Rewrite `LoginPage.tsx`**

Replace the full contents of `client/src/pages/LoginPage.tsx`:

```tsx
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { api, ApiError } from '../api';
import { useAuth } from '../auth-context';
import AuthCard from '../components/AuthCard';
import Button from '../components/Button';
import Input from '../components/Input';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { challengeId, options } = await api<{
        challengeId: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      }>('/auth/login/options', { method: 'POST', body: { email } });
      const response = await startAuthentication({ optionsJSON: options });
      await api('/auth/login/verify', {
        method: 'POST',
        body: { challengeId, response },
      });
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Login was cancelled or failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Log in">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy} className="w-full">
          Continue with passkey
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="mt-4 text-xs text-muted">
        <Link to="/recover" className="text-accent hover:underline">
          Lost your passkeys?
        </Link>{' '}
        ·{' '}
        <Link to="/register" className="text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
```

- [ ] **Step 2: Rewrite `RegisterPage.tsx`**

Replace the full contents of `client/src/pages/RegisterPage.tsx`:

```tsx
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import AuthCard from '../components/AuthCard';
import Button from '../components/Button';
import Input from '../components/Input';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/register', { method: 'POST', body: { email } });
      navigate('/register/verify', { state: { email, purpose: 'register' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Create account">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy} className="w-full">
          Send verification code
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="mt-4 text-xs text-muted">
        Already have an account?{' '}
        <Link to="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
```

- [ ] **Step 3: Rewrite `RecoverPage.tsx`**

Replace the full contents of `client/src/pages/RecoverPage.tsx`:

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import AuthCard from '../components/AuthCard';
import Button from '../components/Button';
import Input from '../components/Input';

export default function RecoverPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/recover', { method: 'POST', body: { email } });
      navigate('/register/verify', { state: { email, purpose: 'recovery' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Recover your account">
      <p className="mb-4 text-sm text-muted">
        We will email you a code, then you can register a new passkey.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy} className="w-full">
          Send recovery code
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </AuthCard>
  );
}
```

- [ ] **Step 4: Rewrite `VerifyOtpPage.tsx`**

Replace the full contents of `client/src/pages/VerifyOtpPage.tsx`:

```tsx
import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import AuthCard from '../components/AuthCard';
import Button from '../components/Button';
import Input from '../components/Input';

interface VerifyState {
  email: string;
  purpose: 'register' | 'recovery';
}

export default function VerifyOtpPage() {
  const location = useLocation();
  const state = location.state as VerifyState | null;
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (!state?.email) return <Navigate to="/register" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/verify-otp', {
        method: 'POST',
        body: { email: state!.email, code, purpose: state!.purpose },
      });
      navigate('/register/passkey');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Check your email">
      <p className="mb-4 text-sm text-muted">
        We sent a 6-digit code to {state.email}.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          id="code"
          label="Code"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          className="font-mono tracking-widest"
        />
        <Button type="submit" disabled={busy} className="w-full">
          Verify
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </AuthCard>
  );
}
```

- [ ] **Step 5: Rewrite `PasskeyPage.tsx`**

Replace the full contents of `client/src/pages/PasskeyPage.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { api, ApiError } from '../api';
import { useAuth } from '../auth-context';
import AuthCard from '../components/AuthCard';
import Button from '../components/Button';

export default function PasskeyPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  async function createPasskey() {
    setBusy(true);
    setError('');
    try {
      const options = await api<PublicKeyCredentialCreationOptionsJSON>(
        '/auth/passkey/options',
        { method: 'POST' },
      );
      const response = await startRegistration({ optionsJSON: options });
      await api('/auth/passkey/verify', {
        method: 'POST',
        body: { response, deviceLabel: navigator.platform || 'Passkey' },
      });
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Passkey creation was cancelled or failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Set up your passkey">
      <p className="mb-4 text-sm text-muted">
        Your device will prompt you to create a passkey for this site.
      </p>
      <Button onClick={createPasskey} disabled={busy} className="w-full">
        Create passkey
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </AuthCard>
  );
}
```

- [ ] **Step 6: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds.

- [ ] **Step 7: Manual visual check**

Run the dev servers and walk through: register → verify OTP → create passkey → dashboard; then log out and log back in; then try "Lost your passkeys?" recovery flow. Confirm all 5 pages render as centered dark cards with no layout breakage.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/LoginPage.tsx client/src/pages/RegisterPage.tsx client/src/pages/RecoverPage.tsx client/src/pages/VerifyOtpPage.tsx client/src/pages/PasskeyPage.tsx
git commit -m "feat(client): restyle auth pages with AuthCard/Button/Input"
```

---

### Task 6: Dashboard page

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx`

**Interfaces:**
- Consumes: `ChartCard` (Task 3, restyled), `formatSen` (`client/src/money.ts`, unchanged), `vizTheme`/`categoryColor`/`setupCharts` (Task 1/unchanged signatures), all dashboard DTOs from `@finance/shared` (unchanged), `api` (unchanged).
- Produces: nothing consumed by later tasks (leaf route component).

- [ ] **Step 1: Rewrite `DashboardPage.tsx`**

Replace the full contents of `client/src/pages/DashboardPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import type { TooltipItem } from 'chart.js';
import {
  BalanceSlice,
  CategoryTotal,
  DashboardSummary,
  MonthPoint,
  TransactionDto,
  UpcomingBill,
} from '@finance/shared';
import { api } from '../api';
import { formatSen } from '../money';
import { categoryColor, vizTheme } from '../viz/theme';
import { setupCharts } from '../viz/setup';
import ChartCard from '../viz/ChartCard';
import Badge from '../components/Badge';

const theme = vizTheme();
setupCharts(theme);

function senTicks(value: unknown): string {
  return formatSen(Number(value));
}

const senTooltip = {
  callbacks: {
    label: (ctx: TooltipItem<any>) => {
      const raw =
        typeof ctx.parsed === 'number' ? ctx.parsed : (ctx.parsed.y ?? 0);
      return ` ${formatSen(raw)}`;
    },
  },
};

const STATUS_LABEL = {
  overdue: 'OVERDUE',
  dueSoon: 'Due soon',
  upcoming: 'Upcoming',
} as const;

const STATUS_TONE = {
  overdue: 'danger',
  dueSoon: 'warning',
  upcoming: 'muted',
} as const;

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [netWorthTrend, setNetWorthTrend] = useState<MonthPoint[]>([]);
  const [balances, setBalances] = useState<BalanceSlice[]>([]);
  const [bills, setBills] = useState<UpcomingBill[]>([]);
  const [categories, setCategories] = useState<CategoryTotal[]>([]);
  const [spendTrend, setSpendTrend] = useState<MonthPoint[]>([]);
  const [recent, setRecent] = useState<TransactionDto[]>([]);

  const load = useCallback(async () => {
    const [s, nw, b, ub, cat, st, rt] = await Promise.all([
      api<DashboardSummary>('/dashboard/summary'),
      api<MonthPoint[]>('/dashboard/net-worth-trend'),
      api<BalanceSlice[]>('/dashboard/balances'),
      api<UpcomingBill[]>('/dashboard/upcoming-bills?days=14'),
      api<CategoryTotal[]>('/dashboard/spending-by-category'),
      api<MonthPoint[]>('/dashboard/spending-trend?months=12'),
      api<TransactionDto[]>('/dashboard/recent-transactions?limit=8'),
    ]);
    setSummary(s);
    setNetWorthTrend(nw);
    setBalances(b);
    setBills(ub);
    setCategories(cat);
    setSpendTrend(st);
    setRecent(rt);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!summary) return <main className="text-sm text-muted">Loading…</main>;

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold">Dashboard</h1>

      {/* 1. Net worth stat tiles */}
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted">Net worth</div>
          <div className="font-mono text-2xl font-semibold tabular-nums text-white">
            {formatSen(summary.netWorth)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted">Assets</div>
          <div className="font-mono text-lg tabular-nums text-ink">
            {formatSen(summary.assets)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted">Liabilities</div>
          <div className="font-mono text-lg tabular-nums text-ink">
            {formatSen(summary.liabilities)}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* 2. Net worth trend */}
        <ChartCard title="Net worth over time">
          <Line
            data={{
              labels: netWorthTrend.map((p) => p.month),
              datasets: [
                {
                  data: netWorthTrend.map((p) => p.value),
                  borderColor: theme.series[0],
                  backgroundColor: theme.series[0],
                  borderWidth: 2,
                  pointRadius: 3,
                  tension: 0.2,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: senTooltip },
              scales: { y: { ticks: { callback: senTicks } } },
            }}
          />
        </ChartCard>

        {/* 3. Account balances */}
        <ChartCard title="Account balances">
          <Doughnut
            data={{
              labels: balances.map((b) => `${b.name} (${b.kind})`),
              datasets: [
                {
                  data: balances.map((b) => b.value),
                  backgroundColor: balances.map(
                    (_, i) => theme.series[i % theme.series.length],
                  ),
                  borderColor: theme.surface,
                  borderWidth: 2,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              plugins: { legend: { position: 'right' }, tooltip: senTooltip },
            }}
          />
        </ChartCard>

        {/* 4. Upcoming bills */}
        <ChartCard title="Upcoming bills (14 days)">
          {bills.length === 0 ? (
            <p className="text-sm text-muted">Nothing due. 🎉</p>
          ) : (
            <ul className="max-h-52 space-y-2 overflow-y-auto text-sm">
              {bills.map((b, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span>
                    <Badge tone={STATUS_TONE[b.status]}>
                      {STATUS_LABEL[b.status]}
                    </Badge>{' '}
                    <span className="text-ink">{b.name}</span>{' '}
                    <span className="text-muted">{b.dueDate.slice(0, 10)}</span>
                  </span>
                  <span className="font-mono tabular-nums text-ink">
                    {formatSen(b.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>

        {/* 5. Spending by category (current month) */}
        <ChartCard title="Spending by category (this month)">
          {categories.length === 0 ? (
            <p className="text-sm text-muted">No expenses recorded yet.</p>
          ) : (
            <div className="flex h-full gap-3">
              <div className="relative flex-1">
                <Doughnut
                  data={{
                    labels: categories.map((c) => c.category),
                    datasets: [
                      {
                        data: categories.map((c) => c.total),
                        backgroundColor: categories.map((c) =>
                          categoryColor(c.category, theme),
                        ),
                        borderColor: theme.surface,
                        borderWidth: 2,
                      },
                    ],
                  }}
                  options={{
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: senTooltip },
                  }}
                />
              </div>
              {/* visible value list: identity + value never rely on color alone */}
              <ul className="space-y-1 text-xs">
                {categories.map((c) => (
                  <li key={c.category} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ background: categoryColor(c.category, theme) }}
                    />
                    <span className="text-ink">{c.category}:</span>{' '}
                    <span className="font-mono tabular-nums text-muted">
                      {formatSen(c.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartCard>

        {/* 6. Spending trend */}
        <ChartCard title="Monthly spending">
          <Bar
            data={{
              labels: spendTrend.map((p) => p.month),
              datasets: [
                {
                  data: spendTrend.map((p) => p.value),
                  backgroundColor: theme.series[0],
                  borderRadius: 4,
                  maxBarThickness: 24,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: senTooltip },
              scales: { y: { ticks: { callback: senTicks } } },
            }}
          />
        </ChartCard>

        {/* Debt overview */}
        <ChartCard title="Debt overview">
          <div>
            <div className="font-mono text-xl font-semibold tabular-nums text-white">
              {formatSen(summary.liabilities)}
            </div>
            <ul className="mt-2 space-y-1 text-sm text-ink">
              <li>
                Loans:{' '}
                <span className="font-mono tabular-nums">
                  {formatSen(summary.loanTotal)}
                </span>
              </li>
              <li>
                Credit cards:{' '}
                <span className="font-mono tabular-nums">
                  {formatSen(summary.cardTotal)}
                </span>
              </li>
            </ul>
            <p className="mt-3 text-xs">
              <Link to="/loans" className="text-accent hover:underline">
                Loans
              </Link>{' '}
              ·{' '}
              <Link to="/credit-cards" className="text-accent hover:underline">
                Credit cards
              </Link>
            </p>
          </div>
        </ChartCard>
      </div>

      {/* 7. Recent transactions */}
      <section className="mt-6">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          Recent transactions —{' '}
          <Link to="/transactions" className="text-accent hover:underline">
            view all
          </Link>
        </h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              {recent.map((t) => (
                <tr key={t.id} className="border-t border-border first:border-t-0">
                  <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted">
                    {t.date.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-ink">{t.type}</td>
                  <td className="px-3 py-2 font-mono tabular-nums text-ink">
                    {formatSen(t.amount)}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {t.category ?? t.note ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds.

- [ ] **Step 3: Manual visual check**

Run the dev servers, log in, view the dashboard at desktop and mobile widths. Confirm all 7 widgets render, RM figures are monospace/tabular, and the card grid collapses to one column below 768px.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "feat(client): restyle dashboard page"
```

---

### Task 7: Transactions page

**Files:**
- Modify: `client/src/pages/TransactionsPage.tsx`

**Interfaces:**
- Consumes: `Drawer`, `Button`, `Input`, `Select`, `Badge`, `IconButton`, `EditIcon`, `TrashIcon`, `Pagination` (Tasks 2–3); `api`, `ApiError` (unchanged); `formatSen`, `parseRM` (unchanged); all transaction DTOs from `@finance/shared` (unchanged).
- Produces: nothing consumed by later tasks (leaf route component). Replaces the `window.prompt()`-based amount edit with a `Drawer` form.

- [ ] **Step 1: Rewrite `TransactionsPage.tsx`**

Replace the full contents of `client/src/pages/TransactionsPage.tsx`:

```tsx
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  BankAccountDto,
  CommitmentDto,
  CreditCardDto,
  EXPENSE_CATEGORIES,
  LoanDto,
  Paginated,
  TransactionDto,
  TransactionType,
} from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';
import Button from '../components/Button';
import Input from '../components/Input';
import Select from '../components/Select';
import Badge from '../components/Badge';
import IconButton from '../components/IconButton';
import { EditIcon, TrashIcon } from '../components/icons';
import Drawer from '../components/Drawer';
import Pagination from '../components/Pagination';

const TYPE_LABELS: Record<TransactionType, string> = {
  income: 'Income',
  expense: 'Expense',
  commitmentPayment: 'Commitment payment',
  loanPayment: 'Loan payment',
  cardPayment: 'Credit card payment',
  cardCharge: 'Credit card charge',
  transfer: 'Transfer',
};

const PAGE_SIZE = 20;

export default function TransactionsPage() {
  const [banks, setBanks] = useState<BankAccountDto[]>([]);
  const [commitments, setCommitments] = useState<CommitmentDto[]>([]);
  const [loans, setLoans] = useState<LoanDto[]>([]);
  const [cards, setCards] = useState<CreditCardDto[]>([]);
  const [items, setItems] = useState<TransactionDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState('');
  const [error, setError] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<TransactionDto | null>(null);

  // form state
  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [linkedEntityId, setLinkedEntityId] = useState('');
  const [note, setNote] = useState('');

  const needsAccount = type !== 'cardCharge';
  const needsCategory = type === 'expense';
  const needsToAccount = type === 'transfer';
  const linkedOptions =
    type === 'commitmentPayment'
      ? commitments.map((c) => [c.id, c.name])
      : type === 'loanPayment'
        ? loans.map((l) => [l.id, l.name])
        : type === 'cardPayment' || type === 'cardCharge'
          ? cards.map((c) => [c.id, c.name])
          : [];

  const loadRefs = useCallback(async () => {
    setBanks(await api<BankAccountDto[]>('/accounts/bank'));
    setCommitments(await api<CommitmentDto[]>('/commitments'));
    setLoans(await api<LoanDto[]>('/loans'));
    setCards(await api<CreditCardDto[]>('/credit-cards'));
  }, []);

  const loadList = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (filterType) params.set('type', filterType);
    const res = await api<Paginated<TransactionDto>>(
      `/transactions?${params.toString()}`,
    );
    setItems(res.items);
    setTotal(res.total);
  }, [page, filterType]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  function openAdd() {
    setEditing(null);
    setType('expense');
    setAmount('');
    setDate(new Date().toISOString().slice(0, 10));
    setCategory(EXPENSE_CATEGORIES[0]);
    setAccountId('');
    setToAccountId('');
    setLinkedEntityId('');
    setNote('');
    setDrawerOpen(true);
  }

  function openEdit(t: TransactionDto) {
    setEditing(t);
    setAmount((t.amount / 100).toFixed(2));
    setDrawerOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const sen = parseRM(amount);
    if (sen === null) return setError('Invalid amount.');
    try {
      if (editing) {
        await api(`/transactions/${editing.id}`, {
          method: 'PATCH',
          body: { amount: sen },
        });
      } else {
        await api('/transactions', {
          method: 'POST',
          body: {
            type,
            amount: sen,
            date,
            ...(needsCategory ? { category } : {}),
            ...(needsAccount ? { accountId } : {}),
            ...(needsToAccount ? { toAccountId } : {}),
            ...(linkedOptions.length ? { linkedEntityId } : {}),
            ...(note ? { note } : {}),
          },
        });
      }
      setDrawerOpen(false);
      await Promise.all([loadList(), loadRefs()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function remove(id: string) {
    try {
      await api(`/transactions/${id}`, { method: 'DELETE' });
      await Promise.all([loadList(), loadRefs()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Transactions</h1>
        <Button onClick={openAdd}>+ Add transaction</Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mb-4">
        <Select
          value={filterType}
          onChange={(e) => {
            setPage(1);
            setFilterType(e.target.value);
          }}
          className="w-auto"
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted">
                  {t.date.slice(0, 10)}
                </td>
                <td className="px-3 py-2">
                  <Badge tone="accent">{TYPE_LABELS[t.type]}</Badge>
                </td>
                <td className="px-3 py-2 font-mono tabular-nums text-ink">
                  {formatSen(t.amount)}
                </td>
                <td className="px-3 py-2 text-ink">{t.category ?? '—'}</td>
                <td className="px-3 py-2 text-muted">{t.note ?? ''}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <IconButton label="Edit" onClick={() => openEdit(t)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      label="Delete"
                      variant="destructive"
                      onClick={() => remove(t.id)}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>{total} transactions</span>
        <Pagination page={page} pageCount={pages} onChange={setPage} />
      </div>

      <Drawer
        open={drawerOpen}
        title={editing ? 'Edit transaction' : 'Add transaction'}
        onClose={() => setDrawerOpen(false)}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          {editing ? (
            <p className="text-xs text-muted">
              {TYPE_LABELS[editing.type]} on {editing.date.slice(0, 10)}
            </p>
          ) : (
            <Select
              id="type"
              label="Type"
              value={type}
              onChange={(e) => {
                setType(e.target.value as TransactionType);
                setLinkedEntityId('');
              }}
            >
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
          <Input
            id="amount"
            label="Amount (RM)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          {!editing && (
            <>
              <Input
                id="date"
                label="Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
              {needsAccount && (
                <Select
                  id="account"
                  label="Account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  required
                >
                  <option value="">Select account…</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
              {needsToAccount && (
                <Select
                  id="toAccount"
                  label="To account"
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  required
                >
                  <option value="">To account…</option>
                  {banks
                    .filter((b) => b.id !== accountId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </Select>
              )}
              {needsCategory && (
                <Select
                  id="category"
                  label="Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
              {linkedOptions.length > 0 && (
                <Select
                  id="linkedEntity"
                  label="Linked to"
                  value={linkedEntityId}
                  onChange={(e) => setLinkedEntityId(e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  {linkedOptions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
              <Input
                id="note"
                label="Note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </>
          )}
          <Button type="submit" className="w-full">
            {editing ? 'Save' : 'Add'}
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds.

- [ ] **Step 3: Manual visual check**

Run the dev servers, add a transaction of each type that has distinct fields (expense, transfer, commitment payment), edit an existing transaction's amount via the drawer, delete one, and change the type filter + page through results if there are more than 20.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/TransactionsPage.tsx
git commit -m "feat(client): restyle transactions page, replace prompt-based edit with drawer"
```

---

### Task 8: Accounts page

**Files:**
- Modify: `client/src/pages/AccountsPage.tsx`

**Interfaces:**
- Consumes: `Drawer`, `Button`, `Input`, `Select`, `IconButton`, `EditIcon`, `TrashIcon` (Tasks 2–3); `api`, `ApiError` (unchanged); `formatSen`, `parseRM` (unchanged); `BankAccountDto`, `SavingsAccountDto`, `ValueSnapshotDto` from `@finance/shared` (unchanged).
- Produces: nothing consumed by later tasks. Replaces `window.prompt()`-based bank rename with a `Drawer` form; savings snapshot history becomes a nested section inside the savings account's `Drawer`.

- [ ] **Step 1: Rewrite `AccountsPage.tsx`**

Replace the full contents of `client/src/pages/AccountsPage.tsx`:

```tsx
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  BankAccountDto,
  SavingsAccountDto,
  ValueSnapshotDto,
} from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';
import Button from '../components/Button';
import Input from '../components/Input';
import Select from '../components/Select';
import IconButton from '../components/IconButton';
import { EditIcon, TrashIcon } from '../components/icons';
import Drawer from '../components/Drawer';

export default function AccountsPage() {
  const [banks, setBanks] = useState<BankAccountDto[]>([]);
  const [savings, setSavings] = useState<SavingsAccountDto[]>([]);
  const [error, setError] = useState('');

  const [addBankOpen, setAddBankOpen] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankOpening, setBankOpening] = useState('');

  const [renaming, setRenaming] = useState<BankAccountDto | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [addSavingsOpen, setAddSavingsOpen] = useState(false);
  const [savName, setSavName] = useState('');
  const [savType, setSavType] = useState<'savings' | 'investment'>('savings');

  const [snapshotsFor, setSnapshotsFor] = useState<SavingsAccountDto | null>(
    null,
  );
  const [snapshots, setSnapshots] = useState<ValueSnapshotDto[]>([]);
  const [snapDate, setSnapDate] = useState('');
  const [snapValue, setSnapValue] = useState('');

  const load = useCallback(async () => {
    setBanks(await api<BankAccountDto[]>('/accounts/bank'));
    setSavings(await api<SavingsAccountDto[]>('/accounts/savings'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handle(err: unknown) {
    setError(err instanceof ApiError ? err.message : 'Something went wrong.');
  }

  async function addBank(e: FormEvent) {
    e.preventDefault();
    setError('');
    const openingBalance = parseRM(bankOpening);
    if (openingBalance === null) return setError('Invalid opening balance.');
    try {
      await api('/accounts/bank', {
        method: 'POST',
        body: { name: bankName, openingBalance },
      });
      setBankName('');
      setBankOpening('');
      setAddBankOpen(false);
      await load();
    } catch (err) {
      handle(err);
    }
  }

  function openRename(b: BankAccountDto) {
    setRenaming(b);
    setRenameValue(b.name);
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    setError('');
    try {
      await api(`/accounts/bank/${renaming.id}`, {
        method: 'PATCH',
        body: { name: renameValue },
      });
      setRenaming(null);
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function deleteBank(id: string) {
    try {
      await api(`/accounts/bank/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function recompute(id: string) {
    try {
      const res = await api<{ drift: number }>(
        `/accounts/bank/${id}/recompute`,
        { method: 'POST' },
      );
      setError(
        res.drift === 0
          ? 'Balance verified: no drift.'
          : `Balance repaired: drift was ${formatSen(res.drift)}.`,
      );
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function addSavings(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/accounts/savings', {
        method: 'POST',
        body: { name: savName, type: savType },
      });
      setSavName('');
      setAddSavingsOpen(false);
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function deleteSavings(id: string) {
    try {
      await api(`/accounts/savings/${id}`, { method: 'DELETE' });
      if (snapshotsFor?.id === id) setSnapshotsFor(null);
      await load();
    } catch (err) {
      handle(err);
    }
  }

  async function openSnapshots(s: SavingsAccountDto) {
    setSnapshotsFor(s);
    setSnapshots(await api<ValueSnapshotDto[]>(`/accounts/savings/${s.id}/snapshots`));
  }

  async function addSnapshot(e: FormEvent) {
    e.preventDefault();
    if (!snapshotsFor) return;
    const value = parseRM(snapValue);
    if (value === null || !snapDate) return setError('Invalid snapshot input.');
    try {
      await api(`/accounts/savings/${snapshotsFor.id}/snapshots`, {
        method: 'POST',
        body: { date: snapDate, value },
      });
      setSnapValue('');
      await openSnapshots(snapshotsFor);
      await load();
    } catch (err) {
      handle(err);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold">Accounts</h1>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Bank accounts
          </h2>
          <Button onClick={() => setAddBankOpen(true)}>+ Add bank account</Button>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {banks.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm text-ink">{b.name}</div>
                <div className="font-mono text-sm tabular-nums text-muted">
                  {formatSen(b.currentBalance)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="secondary" onClick={() => recompute(b.id)}>
                  Verify balance
                </Button>
                <IconButton label="Rename" onClick={() => openRename(b)}>
                  <EditIcon />
                </IconButton>
                <IconButton
                  label="Delete"
                  variant="destructive"
                  onClick={() => deleteBank(b.id)}
                >
                  <TrashIcon />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Savings &amp; investments
          </h2>
          <Button onClick={() => setAddSavingsOpen(true)}>+ Add</Button>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {savings.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm text-ink">
                  {s.name} <span className="text-muted">({s.type})</span>
                </div>
                <div className="font-mono text-sm tabular-nums text-muted">
                  {s.latestValue === null ? 'no value yet' : formatSen(s.latestValue)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="secondary" onClick={() => openSnapshots(s)}>
                  Snapshots
                </Button>
                <IconButton
                  label="Delete"
                  variant="destructive"
                  onClick={() => deleteSavings(s.id)}
                >
                  <TrashIcon />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Drawer
        open={addBankOpen}
        title="Add bank account"
        onClose={() => setAddBankOpen(false)}
      >
        <form onSubmit={addBank} className="flex flex-col gap-4">
          <Input
            id="bankName"
            label="Account name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            required
          />
          <Input
            id="bankOpening"
            label="Opening balance (RM)"
            value={bankOpening}
            onChange={(e) => setBankOpening(e.target.value)}
            required
          />
          <Button type="submit" className="w-full">
            Add bank account
          </Button>
        </form>
      </Drawer>

      <Drawer
        open={renaming !== null}
        title="Rename bank account"
        onClose={() => setRenaming(null)}
      >
        <form onSubmit={submitRename} className="flex flex-col gap-4">
          <Input
            id="renameValue"
            label="Account name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            required
          />
          <Button type="submit" className="w-full">
            Save
          </Button>
        </form>
      </Drawer>

      <Drawer
        open={addSavingsOpen}
        title="Add savings / investment account"
        onClose={() => setAddSavingsOpen(false)}
      >
        <form onSubmit={addSavings} className="flex flex-col gap-4">
          <Input
            id="savName"
            label="Name"
            value={savName}
            onChange={(e) => setSavName(e.target.value)}
            required
          />
          <Select
            id="savType"
            label="Type"
            value={savType}
            onChange={(e) => setSavType(e.target.value as 'savings' | 'investment')}
          >
            <option value="savings">Savings</option>
            <option value="investment">Investment</option>
          </Select>
          <Button type="submit" className="w-full">
            Add
          </Button>
        </form>
      </Drawer>

      <Drawer
        open={snapshotsFor !== null}
        title={snapshotsFor ? `${snapshotsFor.name} — value history` : ''}
        onClose={() => setSnapshotsFor(null)}
      >
        <ul className="mb-4 space-y-1 text-sm">
          {snapshots.map((s) => (
            <li key={s.id} className="flex justify-between">
              <span className="font-mono text-xs tabular-nums text-muted">
                {s.date.slice(0, 10)}
              </span>
              <span className="font-mono tabular-nums text-ink">
                {formatSen(s.value)}
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={addSnapshot} className="flex flex-col gap-4">
          <Input
            id="snapDate"
            label="Date"
            type="date"
            value={snapDate}
            onChange={(e) => setSnapDate(e.target.value)}
            required
          />
          <Input
            id="snapValue"
            label="Value (RM)"
            value={snapValue}
            onChange={(e) => setSnapValue(e.target.value)}
            required
          />
          <Button type="submit" className="w-full">
            Log value
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds.

- [ ] **Step 3: Manual visual check**

Run the dev servers: add a bank account, rename it via the drawer, verify its balance, add a savings account, open its snapshots drawer and log a value, delete a savings account.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/AccountsPage.tsx
git commit -m "feat(client): restyle accounts page, replace prompt-based rename with drawer"
```

---

### Task 9: Commitments page

**Files:**
- Modify: `client/src/pages/CommitmentsPage.tsx`

**Interfaces:**
- Consumes: `Drawer`, `Button`, `Input`, `Badge`, `IconButton`, `TrashIcon` (Tasks 2–3); `api`, `ApiError`, `formatSen`, `parseRM`, `CommitmentDto` (unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite `CommitmentsPage.tsx`**

Replace the full contents of `client/src/pages/CommitmentsPage.tsx`:

```tsx
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CommitmentDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';
import Button from '../components/Button';
import Input from '../components/Input';
import Badge from '../components/Badge';
import IconButton from '../components/IconButton';
import { TrashIcon } from '../components/icons';
import Drawer from '../components/Drawer';

const STATUS_LABEL = {
  overdue: 'OVERDUE',
  dueSoon: 'Due soon',
  upcoming: 'Upcoming',
} as const;

const STATUS_TONE = {
  overdue: 'danger',
  dueSoon: 'warning',
  upcoming: 'muted',
} as const;

export default function CommitmentsPage() {
  const [items, setItems] = useState<CommitmentDto[]>([]);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('1');

  const load = useCallback(async () => {
    setItems(await api<CommitmentDto[]>('/commitments'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    const sen = parseRM(amount);
    if (sen === null) return setError('Invalid amount.');
    try {
      await api('/commitments', {
        method: 'POST',
        body: { name, amount: sen, dueDayOfMonth: parseInt(dueDay, 10) },
      });
      setName('');
      setAmount('');
      setDueDay('1');
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function toggleActive(c: CommitmentDto) {
    try {
      await api(`/commitments/${c.id}`, {
        method: 'PATCH',
        body: { active: !c.active },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  }

  async function remove(id: string) {
    try {
      await api(`/commitments/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Commitments</h1>
        <Button onClick={() => setDrawerOpen(true)}>+ Add commitment</Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm text-ink">
                {c.name}
                <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                {!c.active && <Badge tone="muted">Inactive</Badge>}
              </div>
              <div className="font-mono text-sm tabular-nums text-muted">
                {formatSen(c.amount)} — due {c.nextDueDate.slice(0, 10)}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="secondary" onClick={() => toggleActive(c)}>
                {c.active ? 'Deactivate' : 'Activate'}
              </Button>
              <IconButton
                label="Delete"
                variant="destructive"
                onClick={() => remove(c.id)}
              >
                <TrashIcon />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>

      <Drawer
        open={drawerOpen}
        title="Add commitment"
        onClose={() => setDrawerOpen(false)}
      >
        <form onSubmit={add} className="flex flex-col gap-4">
          <Input
            id="name"
            label="Name (e.g. Rent)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            id="amount"
            label="Amount (RM)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <Input
            id="dueDay"
            label="Due day of month"
            type="number"
            min={1}
            max={31}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            required
          />
          <Button type="submit" className="w-full">
            Add commitment
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds.

- [ ] **Step 3: Manual visual check**

Run the dev servers: add a commitment, toggle active/inactive, delete one, confirm status badges show the correct tone (overdue = red, due soon = amber).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/CommitmentsPage.tsx
git commit -m "feat(client): restyle commitments page"
```

---

### Task 10: Loans page

**Files:**
- Modify: `client/src/pages/LoansPage.tsx`

**Interfaces:**
- Consumes: `Drawer`, `Button`, `Input`, `IconButton`, `TrashIcon` (Tasks 2–3); `api`, `ApiError`, `formatSen`, `parseRM`, `LoanDto` (unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite `LoansPage.tsx`**

Replace the full contents of `client/src/pages/LoansPage.tsx`:

```tsx
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { LoanDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';
import Button from '../components/Button';
import Input from '../components/Input';
import IconButton from '../components/IconButton';
import { TrashIcon } from '../components/icons';
import Drawer from '../components/Drawer';

export default function LoansPage() {
  const [items, setItems] = useState<LoanDto[]>([]);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [balance, setBalance] = useState('');

  const load = useCallback(async () => {
    setItems(await api<LoanDto[]>('/loans'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    const principalSen = parseRM(principal);
    if (principalSen === null) return setError('Invalid principal.');
    const balanceSen = balance ? parseRM(balance) : null;
    if (balance && balanceSen === null) return setError('Invalid balance.');
    try {
      await api('/loans', {
        method: 'POST',
        body: {
          name,
          principal: principalSen,
          interestRate: parseFloat(rate) || 0,
          ...(balanceSen !== null ? { currentBalance: balanceSen } : {}),
        },
      });
      setName('');
      setPrincipal('');
      setRate('');
      setBalance('');
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function remove(id: string) {
    try {
      await api(`/loans/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Loans</h1>
        <Button onClick={() => setDrawerOpen(true)}>+ Add loan</Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((l) => {
          const paidPct =
            l.principal > 0
              ? Math.round(((l.principal - l.currentBalance) / l.principal) * 100)
              : 0;
          return (
            <li key={l.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm text-ink">{l.name}</div>
                <div className="font-mono text-sm tabular-nums text-muted">
                  {formatSen(l.currentBalance)} remaining of{' '}
                  {formatSen(l.principal)} ({paidPct}% paid, {l.interestRate}% p.a.)
                </div>
              </div>
              <IconButton
                label="Delete"
                variant="destructive"
                onClick={() => remove(l.id)}
              >
                <TrashIcon />
              </IconButton>
            </li>
          );
        })}
      </ul>

      <Drawer open={drawerOpen} title="Add loan" onClose={() => setDrawerOpen(false)}>
        <form onSubmit={add} className="flex flex-col gap-4">
          <Input
            id="name"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            id="principal"
            label="Principal (RM)"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            required
          />
          <Input
            id="rate"
            label="Interest rate % p.a."
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <Input
            id="balance"
            label="Current balance (RM, optional)"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
          <Button type="submit" className="w-full">
            Add loan
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds.

- [ ] **Step 3: Manual visual check**

Run the dev servers: add a loan with and without an explicit current balance, confirm the paid % renders, delete one.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/LoansPage.tsx
git commit -m "feat(client): restyle loans page"
```

---

### Task 11: Credit Cards page

**Files:**
- Modify: `client/src/pages/CreditCardsPage.tsx`

**Interfaces:**
- Consumes: `Drawer`, `Button`, `Input`, `IconButton`, `TrashIcon` (Tasks 2–3); `api`, `ApiError`, `formatSen`, `parseRM`, `CreditCardDto` (unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite `CreditCardsPage.tsx`**

Replace the full contents of `client/src/pages/CreditCardsPage.tsx`:

```tsx
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CreditCardDto } from '@finance/shared';
import { api, ApiError } from '../api';
import { formatSen, parseRM } from '../money';
import Button from '../components/Button';
import Input from '../components/Input';
import IconButton from '../components/IconButton';
import { TrashIcon } from '../components/icons';
import Drawer from '../components/Drawer';

export default function CreditCardsPage() {
  const [items, setItems] = useState<CreditCardDto[]>([]);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [statementDay, setStatementDay] = useState('1');
  const [dueDay, setDueDay] = useState('22');

  const load = useCallback(async () => {
    setItems(await api<CreditCardDto[]>('/credit-cards'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    const limitSen = parseRM(limit);
    if (limitSen === null) return setError('Invalid credit limit.');
    try {
      await api('/credit-cards', {
        method: 'POST',
        body: {
          name,
          creditLimit: limitSen,
          statementDay: parseInt(statementDay, 10),
          dueDay: parseInt(dueDay, 10),
        },
      });
      setName('');
      setLimit('');
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function remove(id: string) {
    try {
      await api(`/credit-cards/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Credit cards</h1>
        <Button onClick={() => setDrawerOpen(true)}>+ Add card</Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm text-ink">{c.name}</div>
              <div className="font-mono text-sm tabular-nums text-muted">
                statement {formatSen(c.statementBalance)} (due day {c.dueDay}),
                current {formatSen(c.currentBalance)} of{' '}
                {formatSen(c.creditLimit)} limit
              </div>
            </div>
            <IconButton
              label="Delete"
              variant="destructive"
              onClick={() => remove(c.id)}
            >
              <TrashIcon />
            </IconButton>
          </li>
        ))}
      </ul>

      <Drawer open={drawerOpen} title="Add card" onClose={() => setDrawerOpen(false)}>
        <form onSubmit={add} className="flex flex-col gap-4">
          <Input
            id="name"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            id="limit"
            label="Credit limit (RM)"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
          />
          <Input
            id="statementDay"
            label="Statement day"
            type="number"
            min={1}
            max={28}
            value={statementDay}
            onChange={(e) => setStatementDay(e.target.value)}
          />
          <Input
            id="dueDay"
            label="Payment due day"
            type="number"
            min={1}
            max={28}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
          />
          <Button type="submit" className="w-full">
            Add card
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds.

- [ ] **Step 3: Manual visual check**

Run the dev servers: add a credit card, confirm statement/current/limit figures render correctly, delete one.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/CreditCardsPage.tsx
git commit -m "feat(client): restyle credit cards page"
```

---

### Task 12: Settings page

**Files:**
- Modify: `client/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `Button`, `IconButton`, `TrashIcon` (Tasks 2–3); `api`, `ApiError`, `PasskeySummary` from `@finance/shared` (unchanged).
- Produces: nothing consumed by later tasks. Last task in the plan.

- [ ] **Step 1: Rewrite `SettingsPage.tsx`**

Replace the full contents of `client/src/pages/SettingsPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { PasskeySummary } from '@finance/shared';
import { api, ApiError } from '../api';
import Button from '../components/Button';
import IconButton from '../components/IconButton';
import { TrashIcon } from '../components/icons';

interface AuditItem {
  action: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export default function SettingsPage() {
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setPasskeys(await api<PasskeySummary[]>('/passkeys'));
    const page = await api<{ items: AuditItem[]; total: number }>(
      '/audit-log?page=1&pageSize=20',
    );
    setAudit(page.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addPasskey() {
    setError('');
    try {
      const options = await api<PublicKeyCredentialCreationOptionsJSON>(
        '/auth/passkey/options',
        { method: 'POST' },
      );
      const response = await startRegistration({ optionsJSON: options });
      await api('/auth/passkey/verify', {
        method: 'POST',
        body: { response, deviceLabel: navigator.platform || 'Passkey' },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Passkey creation failed.');
    }
  }

  async function removePasskey(id: string) {
    setError('');
    try {
      await api(`/passkeys/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove passkey.');
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Link to="/dashboard" className="text-xs text-accent hover:underline">
          Back to dashboard
        </Link>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Passkeys
          </h2>
          <Button onClick={addPasskey}>+ Add a passkey</Button>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3">
              <div className="text-sm text-ink">
                {p.deviceLabel}{' '}
                <span className="text-muted">
                  — added {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </div>
              <IconButton
                label="Remove"
                variant="destructive"
                onClick={() => removePasskey(p.id)}
              >
                <TrashIcon />
              </IconButton>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          Recent activity
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {audit.map((a, i) => (
            <li key={i} className="px-4 py-2 text-sm">
              <span className="font-mono text-xs tabular-nums text-muted">
                {new Date(a.timestamp).toLocaleString()}
              </span>{' '}
              <span className="text-ink">{a.action}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace client`
Expected: succeeds.

- [ ] **Step 3: Full regression check**

Run: `npm test --workspace client`
Expected: `money.spec.ts` and `api.spec.ts` still pass (unmodified throughout this plan).

Run: `npm run build --workspace client`
Expected: succeeds — this is the final task, so this confirms the whole app compiles clean end to end.

Manually walk through every page one more time (register/login, dashboard, transactions, accounts, commitments, loans, credit cards, settings) at both desktop and mobile widths to confirm nothing regressed across tasks.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/SettingsPage.tsx
git commit -m "feat(client): restyle settings page"
```
