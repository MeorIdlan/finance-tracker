import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { AuthGuard } from './auth.guard';

@Module({
  providers: [SessionService, AuthGuard],
  exports: [SessionService, AuthGuard],
})
export class AuthGuardModule {}
