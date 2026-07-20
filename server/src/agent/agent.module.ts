import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { AgentTokenService } from './agent-token.service';
import { AgentTokenController } from './agent-token.controller';
import { BearerAuthGuard } from './bearer-auth.guard';

@Module({
  imports: [AuthGuardModule],
  controllers: [AgentTokenController],
  providers: [AgentTokenService, BearerAuthGuard],
  exports: [AgentTokenService, BearerAuthGuard],
})
export class AgentModule {}
