import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SessionScope } from '../database/schemas/session.schema';
import { PENDING_TTL_MS } from '../auth-guard/session.service';

export function setSessionCookie(
  res: Response,
  config: ConfigService,
  token: string,
  scope: SessionScope,
): void {
  const days = parseInt(config.get('SESSION_TTL_DAYS', '30'), 10);
  const fullTtlMs = days * 24 * 60 * 60 * 1000;
  const maxAge = scope === 'full' ? fullTtlMs : PENDING_TTL_MS;
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.get('COOKIE_SECURE', 'false') === 'true',
    maxAge,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie('sid', { path: '/' });
}
