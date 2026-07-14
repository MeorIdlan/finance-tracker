import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { WebauthnService } from './webauthn.service';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';

@Module({
  imports: [EmailModule, AuditModule, AuthGuardModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, WebauthnService],
  exports: [WebauthnService],
})
export class AuthModule {}
