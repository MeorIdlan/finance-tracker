import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth-guard/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth-guard/session.service';
import { AgentTokenService } from './agent-token.service';
import { CreateAgentTokenDto } from './dto';

@Controller('agent-token')
@UseGuards(AuthGuard)
export class AgentTokenController {
  constructor(private tokens: AgentTokenService) {}

  @Get('list')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tokens.list(user.userId);
  }

  @Post('create')
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateAgentTokenDto,
  ) {
    const { token } = await this.tokens.create(user.userId, body.label, 'manual');
    return { token };
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.tokens.revoke(user.userId, id);
  }
}
