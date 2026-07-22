import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AgentPage from './AgentPage';
import { api } from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);

describe('AgentPage', () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  it('shows "no tokens yet" state', async () => {
    mockedApi.mockResolvedValueOnce([]);
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText(/no agent tokens/i)).toBeInTheDocument(),
    );
  });

  it('creating a token shows it once and the copy-paste command', async () => {
    mockedApi.mockResolvedValueOnce([]);
    mockedApi.mockResolvedValueOnce({ token: 'ftk_abc123' });
    mockedApi.mockResolvedValueOnce([
      {
        id: '1',
        label: 'manual token',
        createdAt: '2026-07-01T00:00:00.000Z',
        lastUsedAt: null,
        source: 'manual',
      },
    ]);
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByLabelText(/label/i));
    await userEvent.type(screen.getByLabelText(/label/i), 'manual token');
    await userEvent.click(screen.getByRole('button', { name: /create new token/i }));
    await waitFor(() => expect(screen.getByText(/ftk_abc123/)).toBeInTheDocument());
    expect(screen.getByText(/claude mcp add/)).toBeInTheDocument();
    expect(mockedApi).toHaveBeenCalledWith('/agent-token/create', {
      method: 'POST',
      body: { label: 'manual token' },
    });
  });

  it('lists existing tokens with a revoke button each', async () => {
    mockedApi.mockResolvedValueOnce([
      {
        id: '1',
        label: 'manual script',
        createdAt: '2026-07-01T00:00:00.000Z',
        lastUsedAt: null,
        source: 'manual',
      },
      {
        id: '2',
        label: 'Claude Desktop (OAuth)',
        createdAt: '2026-07-02T00:00:00.000Z',
        lastUsedAt: null,
        source: 'oauth',
      },
    ]);
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('manual script')).toBeInTheDocument());
    expect(screen.getByText('Claude Desktop (OAuth)')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /revoke/i })).toHaveLength(2);
  });

  it('revoking a token calls the delete endpoint and reloads the list', async () => {
    mockedApi.mockResolvedValueOnce([
      {
        id: '1',
        label: 'manual script',
        createdAt: '2026-07-01T00:00:00.000Z',
        lastUsedAt: null,
        source: 'manual',
      },
    ]);
    mockedApi.mockResolvedValueOnce(undefined);
    mockedApi.mockResolvedValueOnce([]);
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByRole('button', { name: /revoke/i }));
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/agent-token/1', { method: 'DELETE' }),
    );
  });
});
