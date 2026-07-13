import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

export function setSessionCookie(
  res: Response,
  config: ConfigService,
  token: string,
): void {
  const days = parseInt(config.get('SESSION_TTL_DAYS', '30'), 10);
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.get('COOKIE_SECURE', 'false') === 'true',
    maxAge: days * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie('sid', { path: '/' });
}
