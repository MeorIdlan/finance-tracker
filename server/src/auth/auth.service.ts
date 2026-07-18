import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../database/schemas/user.schema';
import { OtpPurpose } from '../database/schemas/otp-code.schema';
import { OtpService } from './otp.service';
import { SessionService } from '../auth-guard/session.service';
import { EmailService } from '../email/email.service';
import { AuditLogService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  private readonly adminEmail: string;

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private otp: OtpService,
    private email: EmailService,
    private sessions: SessionService,
    private audit: AuditLogService,
    private config: ConfigService,
  ) {
    this.adminEmail = this.config.getOrThrow<string>('ADMIN_EMAIL');
  }

  async startRegistration(name: string, email: string): Promise<void> {
    const normalized = email.toLowerCase();
    const existing = await this.userModel.findOne({ email: normalized });
    if (existing?.emailVerified) {
      throw new ConflictException('Account already exists. Log in instead.');
    }
    const user =
      existing ??
      (await this.userModel.create({
        email: normalized,
        name,
        emailVerified: false,
      }));
    if (existing && existing.name !== name) {
      existing.name = name;
      await existing.save();
    }
    const code = await this.otp.issue(normalized, 'register');
    await this.email.sendRegistrationRequestEmail(this.adminEmail, code, {
      name,
      email: normalized,
    });
    await this.audit.log({
      userId: user._id,
      action: 'auth.otp_requested',
      metadata: { purpose: 'register', name },
    });
  }

  async startRecovery(email: string): Promise<void> {
    const normalized = email.toLowerCase();
    const user = await this.userModel.findOne({
      email: normalized,
      emailVerified: true,
    });
    if (!user) throw new NotFoundException('No account for this email.');
    const code = await this.otp.issue(normalized, 'recovery');
    await this.email.sendOtpEmail(normalized, code);
    await this.audit.log({ userId: user._id, action: 'auth.recovery_started' });
  }

  async verifyOtp(
    email: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<string> {
    const normalized = email.toLowerCase();
    const ok = await this.otp.verify(normalized, purpose, code);
    if (!ok) throw new UnauthorizedException('Invalid or expired code.');
    const user = await this.userModel.findOne({ email: normalized });
    if (!user) throw new UnauthorizedException();
    if (purpose === 'register' && !user.emailVerified) {
      user.emailVerified = true;
      await user.save();
      await this.audit.log({ userId: user._id, action: 'auth.registered' });
    }
    if (purpose === 'recovery' && !user.emailVerified) {
      throw new UnauthorizedException();
    }
    return this.sessions.create(user._id, 'pending_passkey');
  }
}
