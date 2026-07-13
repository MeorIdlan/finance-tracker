import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, ApiError } from './api';

describe('api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs JSON with credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '1', email: 'a@b.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await api<{ id: string }>('/auth/me');
    expect(result.id).toBe('1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ credentials: 'include', method: 'GET' }),
    );
  });

  it('POSTs a JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api('/auth/register', { method: 'POST', body: { email: 'a@b.com' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.com' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('throws ApiError with the server message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Invalid or expired code.' }), {
          status: 401,
        }),
      ),
    );
    await expect(api('/auth/verify-otp', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid or expired code.',
    });
    await expect(api('/x')).rejects.toBeInstanceOf(ApiError);
  });
});
