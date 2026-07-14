import { setSessionCookie, clearSessionCookie } from './cookie';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { PENDING_TTL_MS } from '../auth-guard/session.service';

function mockRes(): { res: Response; opts: Record<string, unknown>[] } {
  const opts: Record<string, unknown>[] = [];
  const res = {
    cookie: (_name: string, _value: string, options: Record<string, unknown>) => {
      opts.push(options);
    },
    clearCookie: () => {},
  } as unknown as Response;
  return { res, opts };
}

describe('setSessionCookie', () => {
  const config = {
    get: (key: string, def?: string) =>
      key === 'SESSION_TTL_DAYS' ? '30' : (def ?? 'false'),
  } as unknown as ConfigService;

  it('uses the 15-minute pending TTL for pending_passkey scope', () => {
    const { res, opts } = mockRes();
    setSessionCookie(res, config, 'tok', 'pending_passkey');
    expect(opts[0].maxAge).toBe(PENDING_TTL_MS);
  });

  it('uses SESSION_TTL_DAYS for full scope', () => {
    const { res, opts } = mockRes();
    setSessionCookie(res, config, 'tok', 'full');
    expect(opts[0].maxAge).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
