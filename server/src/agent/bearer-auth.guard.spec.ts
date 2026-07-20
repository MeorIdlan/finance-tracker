import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { BearerAuthGuard } from './bearer-auth.guard';
import { AgentTokenService } from './agent-token.service';

function contextWithHeader(header?: string): ExecutionContext {
  const req: { headers: Record<string, string>; user?: unknown } = { headers: {} };
  if (header !== undefined) req.headers.authorization = header;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('BearerAuthGuard', () => {
  it('rejects a missing Authorization header', async () => {
    const guard = new BearerAuthGuard({ resolve: jest.fn() } as unknown as AgentTokenService);
    await expect(guard.canActivate(contextWithHeader(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a header without the Bearer scheme', async () => {
    const guard = new BearerAuthGuard({ resolve: jest.fn() } as unknown as AgentTokenService);
    await expect(guard.canActivate(contextWithHeader('Basic abc'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an unresolvable token', async () => {
    const resolve = jest.fn().mockResolvedValue(null);
    const guard = new BearerAuthGuard({ resolve } as unknown as AgentTokenService);
    await expect(
      guard.canActivate(contextWithHeader('Bearer ftk_bad')),
    ).rejects.toThrow(UnauthorizedException);
    expect(resolve).toHaveBeenCalledWith('ftk_bad');
  });

  it('attaches req.user on a valid token', async () => {
    const resolve = jest.fn().mockResolvedValue({ userId: 'user-1' });
    const guard = new BearerAuthGuard({ resolve } as unknown as AgentTokenService);
    const ctx = contextWithHeader('Bearer ftk_good');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const req = ctx.switchToHttp().getRequest() as { user?: { userId: string } };
    expect(req.user).toEqual({ userId: 'user-1' });
  });
});
