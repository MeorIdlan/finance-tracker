import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { AuthService } from './auth.service';
import { EmailDto, VerifyOtpDto, PasskeyVerifyDto } from './dto';
import { setSessionCookie } from './cookie';
import { AuthGuard, AllowPendingSession } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RequestUser, SessionService } from './session.service';
import { WebauthnService } from './webauthn.service';
import { AuditLogService } from '../audit/audit.service';

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private config: ConfigService,
    private webauthn: WebauthnService,
    private sessions: SessionService,
    private audit: AuditLogService,
  ) {}

  @Post('register')
  async register(@Body() dto: EmailDto) {
    await this.auth.startRegistration(dto.email);
    return { message: 'Verification code sent.' };
  }

  @Post('recover')
  async recover(@Body() dto: EmailDto) {
    await this.auth.startRecovery(dto.email);
    return { message: 'Verification code sent.' };
  }

  @Post('verify-otp')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = await this.auth.verifyOtp(dto.email, dto.code, dto.purpose);
    setSessionCookie(res, this.config, token);
    return { scope: 'pending_passkey' };
  }

  @Post('passkey/options')
  @UseGuards(AuthGuard)
  @AllowPendingSession()
  async passkeyOptions(@CurrentUser() user: RequestUser) {
    return this.webauthn.registrationOptions(user.userId, user.email);
  }

  @Post('passkey/verify')
  @UseGuards(AuthGuard)
  @AllowPendingSession()
  async passkeyVerify(
    @CurrentUser() user: RequestUser,
    @Body() dto: PasskeyVerifyDto,
  ) {
    const cred = await this.webauthn.verifyRegistration(
      user.userId,
      dto.response as unknown as RegistrationResponseJSON,
      dto.deviceLabel ?? 'Passkey',
    );
    if (user.scope === 'pending_passkey') {
      await this.sessions.upgrade(user.sessionId);
    }
    await this.audit.log({
      userId: user.userId,
      action: 'passkey.added',
      entityType: 'Credential',
      entityId: cred.credentialId,
      metadata: { deviceLabel: cred.deviceLabel },
    });
    return {
      id: cred._id.toHexString(),
      deviceLabel: cred.deviceLabel,
      createdAt: cred.createdAt.toISOString(),
    };
  }
}
