import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OAuthConsentPage from './OAuthConsentPage';
import { api } from '../api';
import { useAuth } from '../auth-context';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, api: vi.fn() };
});

vi.mock('../auth-context', () => ({
  useAuth: vi.fn(),
}));

const mockedApi = vi.mocked(api);
const mockedUseAuth = vi.mocked(useAuth);

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/oauth-consent" element={<OAuthConsentPage />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OAuthConsentPage', () => {
  beforeEach(() => {
    mockedApi.mockReset();
    mockedUseAuth.mockReset();
  });

  it('redirects to login, preserving the original query, when not authenticated', async () => {
    mockedUseAuth.mockReturnValue({ user: null, loading: false, refresh: vi.fn() });
    renderAt(
      '/oauth-consent?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcb&state=xyz&code_challenge=chal&code_challenge_method=S256',
    );
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
  });

  it('shows nothing while auth is loading', () => {
    mockedUseAuth.mockReturnValue({ user: null, loading: true, refresh: vi.fn() });
    renderAt('/oauth-consent?redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcb');
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('calls approve with the query params when authenticated', async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'a@b.com' },
      loading: false,
      refresh: vi.fn(),
    });
    mockedApi.mockResolvedValueOnce({
      redirectUrl: 'http://127.0.0.1:1234/cb?code=abc&state=xyz',
    });
    renderAt(
      '/oauth-consent?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcb&state=xyz&code_challenge=chal&code_challenge_method=S256',
    );
    await waitFor(() => screen.getByRole('button', { name: /approve/i }));
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/oauth/authorize/approve', {
        method: 'POST',
        body: {
          redirectUri: 'http://127.0.0.1:1234/cb',
          state: 'xyz',
          codeChallenge: 'chal',
          codeChallengeMethod: 'S256',
        },
      }),
    );
  });
});
