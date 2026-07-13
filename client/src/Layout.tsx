import { ReactNode } from 'react';
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

export default function Layout({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    await refresh();
    navigate('/login');
  }

  return (
    <div>
      <nav>
        {LINKS.map(([to, label]) => (
          <NavLink key={to} to={to}>
            {label}
          </NavLink>
        ))}
        <span>{user?.email}</span>
        <button onClick={logout}>Log out</button>
      </nav>
      <div>{children}</div>
    </div>
  );
}
