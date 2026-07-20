import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth-guard/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth-guard/session.service';
import { AgentTokenService } from './agent-token.service';

@Controller('agent-token')
@UseGuards(AuthGuard)
export class AgentTokenController {
  constructor(private tokens: AgentTokenService) {}

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.tokens.status(user.userId);
  }

  @Post('rotate')
  @HttpCode(201)
  async rotate(@CurrentUser() user: AuthenticatedUser) {
    const token = await this.tokens.rotate(user.userId);
    return { token };
  }
}
