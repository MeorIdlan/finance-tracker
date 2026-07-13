import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SessionService } from './session.service';

export const ALLOW_PENDING_KEY = 'allowPendingSession';
export const AllowPendingSession = () => SetMetadata(ALLOW_PENDING_KEY, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private sessions: SessionService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.sid;
    if (!token) throw new UnauthorizedException();
    const user = await this.sessions.validate(token);
    if (!user) throw new UnauthorizedException();
    const allowPending = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PENDING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (user.scope !== 'full' && !allowPending) {
      throw new UnauthorizedException('Passkey setup incomplete');
    }
    (req as Request & { user: unknown }).user = user;
    return true;
  }
}
