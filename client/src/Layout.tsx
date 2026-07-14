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
