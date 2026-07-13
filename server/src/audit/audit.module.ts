import { Module } from '@nestjs/common';
import { AuditLogService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';

@Module({
  imports: [AuthGuardModule],
  controllers: [AuditController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
