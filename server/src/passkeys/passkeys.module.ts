import { Module } from '@nestjs/common';
import { PasskeysController } from './passkeys.controller';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PasskeysController],
})
export class PasskeysModule {}
