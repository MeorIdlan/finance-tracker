import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AgentTokenService } from './agent-token.service';

export interface AgentUser {
  userId: string;
}

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(private tokens: AgentTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedException();
    const resolved = await this.tokens.resolve(token);
    if (!resolved) throw new UnauthorizedException();
    (req as Request & { user: AgentUser }).user = resolved;
    return true;
  }
}
