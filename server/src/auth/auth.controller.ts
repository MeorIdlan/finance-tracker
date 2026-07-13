import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response, Request } from 'express';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { AuthService } from './auth.service';
import { EmailDto, VerifyOtpDto, PasskeyVerifyDto, LoginVerifyDto } from './dto';
import { setSessionCookie, clearSessionCookie } from './cookie';
import { AuthGuard, AllowPendingSession } from '../auth-guard/auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RequestUser, SessionService } from '../auth-guard/session.service';
import { WebauthnService } from './webauthn.service';
import { AuditLogService } from '../audit/audit.service';
import { AuthUser } from '@finance/shared';

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

  @Post('login/options')
  async loginOptions(@Body() dto: EmailDto) {
    return this.webauthn.authenticationOptions(dto.email);
  }

  @Post('login/verify')
  async loginVerify(
    @Body() dto: LoginVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.webauthn.verifyAuthentication(
      dto.challengeId,
      dto.response as unknown as AuthenticationResponseJSON,
    );
    const token = await this.sessions.create(userId, 'full');
    setSessionCookie(res, this.config, token);
    await this.audit.log({ userId, action: 'auth.login' });
    return { ok: true };
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @AllowPendingSession()
  async logout(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string>).sid;
    await this.sessions.destroy(token);
    clearSessionCookie(res);
    await this.audit.log({ userId: user.userId, action: 'auth.logout' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: RequestUser): AuthUser {
    return { id: user.userId, email: user.email };
  }
}
