import { Body, Controller, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { EmailDto, VerifyOtpDto } from './dto';
import { setSessionCookie } from './cookie';

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private config: ConfigService,
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
}
