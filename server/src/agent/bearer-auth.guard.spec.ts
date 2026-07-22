import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BearerAuthGuard } from './bearer-auth.guard';
import { AgentTokenService } from './agent-token.service';

function contextWithHeader(header?: string): {
  ctx: ExecutionContext;
  setHeader: jest.Mock;
} {
  const req: { headers: Record<string, string>; user?: unknown } = { headers: {} };
  if (header !== undefined) req.headers.authorization = header;
  const setHeader = jest.fn();
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  return { ctx, setHeader };
}

const config = { get: jest.fn().mockReturnValue('http://localhost:5173') } as unknown as ConfigService;

describe('BearerAuthGuard', () => {
  it('rejects a missing Authorization header', async () => {
    const guard = new BearerAuthGuard({ resolve: jest.fn() } as unknown as AgentTokenService, config);
    const { ctx, setHeader } = contextWithHeader(undefined);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer resource_metadata="http://localhost:5173/.well-known/oauth-protected-resource"',
    );
  });

  it('rejects a header without the Bearer scheme', async () => {
    const guard = new BearerAuthGuard({ resolve: jest.fn() } as unknown as AgentTokenService, config);
    const { ctx } = contextWithHeader('Basic abc');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unresolvable token', async () => {
    const resolve = jest.fn().mockResolvedValue(null);
    const guard = new BearerAuthGuard({ resolve } as unknown as AgentTokenService, config);
    const { ctx } = contextWithHeader('Bearer ftk_bad');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(resolve).toHaveBeenCalledWith('ftk_bad');
  });

  it('attaches req.user on a valid token', async () => {
    const resolve = jest.fn().mockResolvedValue({ userId: 'user-1' });
    const guard = new BearerAuthGuard({ resolve } as unknown as AgentTokenService, config);
    const { ctx } = contextWithHeader('Bearer ftk_good');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const req = ctx.switchToHttp().getRequest() as { user?: { userId: string } };
    expect(req.user).toEqual({ userId: 'user-1' });
  });
});
