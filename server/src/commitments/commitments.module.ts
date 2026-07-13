import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { CommitmentsService } from './commitments.service';
import { CommitmentsController } from './commitments.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CommitmentsController],
  providers: [CommitmentsService],
  exports: [CommitmentsService],
})
export class CommitmentsModule {}
