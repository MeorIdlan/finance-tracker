import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth-context';

export default function DashboardPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    await refresh();
    navigate('/login');
  }

  return (
    <main>
      <header>
        <h1>Dashboard</h1>
        <nav>
          <span>{user?.email}</span> <Link to="/settings">Settings</Link>{' '}
          <button onClick={logout}>Log out</button>
        </nav>
      </header>
      <p>Financial widgets arrive in Plan 2/3.</p>
    </main>
  );
}
