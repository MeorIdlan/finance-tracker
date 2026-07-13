import { Module } from '@nestjs/common';
import { PasskeysController } from './passkeys.controller';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuthGuardModule, AuditModule],
  controllers: [PasskeysController],
})
export class PasskeysModule {}
