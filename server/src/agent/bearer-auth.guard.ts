import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AgentTokenService } from './agent-token.service';

export interface AgentUser {
  userId: string;
}

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    private tokens: AgentTokenService,
    private config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw this.unauthorized(context);
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw this.unauthorized(context);
    const resolved = await this.tokens.resolve(token);
    if (!resolved) throw this.unauthorized(context);
    (req as Request & { user: AgentUser }).user = resolved;
    return true;
  }

  // RFC 9728: MCP clients (e.g. Claude Desktop) discover the authorization
  // server by following this header off an unauthenticated 401, not by
  // guessing well-known paths on the MCP server's own origin.
  private unauthorized(context: ExecutionContext): UnauthorizedException {
    const origin = this.config.get('WEBAUTHN_ORIGIN', 'http://localhost:5173');
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    );
    return new UnauthorizedException();
  }
}
