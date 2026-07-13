export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T = unknown>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options?.method ?? 'GET',
    credentials: 'include',
    headers: options?.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { message?: string | string[] };
      if (data.message) {
        message = Array.isArray(data.message) ? data.message[0] : data.message;
      }
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
