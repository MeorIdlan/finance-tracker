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

  it('shows "no token yet" state and a Generate button', async () => {
    mockedApi.mockResolvedValueOnce({ hasToken: false, createdAt: null, lastUsedAt: null });
    render(<MemoryRouter><AgentPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no agent token/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /generate token/i })).toBeInTheDocument();
  });

  it('generating a token shows it once and the copy-paste command', async () => {
    mockedApi.mockResolvedValueOnce({ hasToken: false, createdAt: null, lastUsedAt: null });
    mockedApi.mockResolvedValueOnce({ token: 'ftk_abc123' });
    render(<MemoryRouter><AgentPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /generate token/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate token/i }));
    await waitFor(() => expect(screen.getByText(/ftk_abc123/)).toBeInTheDocument());
    expect(screen.getByText(/claude mcp add/)).toBeInTheDocument();
    expect(mockedApi).toHaveBeenCalledWith('/agent-token/rotate', { method: 'POST' });
  });

  it('shows Rotate (not Generate) when a token already exists', async () => {
    mockedApi.mockResolvedValueOnce({
      hasToken: true,
      createdAt: '2026-07-01T00:00:00.000Z',
      lastUsedAt: null,
    });
    render(<MemoryRouter><AgentPage /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /rotate token/i })).toBeInTheDocument(),
    );
  });
});
