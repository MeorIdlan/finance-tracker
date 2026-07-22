import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { OauthMetadataController } from './oauth-metadata.controller';
import { OauthController } from './oauth.controller';
import { OauthCodeStore } from './oauth-code.store';

@Module({
  imports: [AgentModule, AuthGuardModule],
  controllers: [OauthMetadataController, OauthController],
  providers: [OauthCodeStore],
})
export class OauthModule {}
