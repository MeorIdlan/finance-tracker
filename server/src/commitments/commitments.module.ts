import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { AuditModule } from '../audit/audit.module';
import { CommitmentsService } from './commitments.service';
import { CommitmentsController } from './commitments.controller';

@Module({
  imports: [AuthGuardModule, AuditModule],
  controllers: [CommitmentsController],
  providers: [CommitmentsService],
  exports: [CommitmentsService],
})
export class CommitmentsModule {}
