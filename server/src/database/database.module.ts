import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { Credential, CredentialSchema } from './schemas/credential.schema';
import { OtpCode, OtpCodeSchema } from './schemas/otp-code.schema';
import { Session, SessionSchema } from './schemas/session.schema';
import {
  WebauthnChallenge,
  WebauthnChallengeSchema,
} from './schemas/webauthn-challenge.schema';
import {
  EmailQuotaUsage,
  EmailQuotaUsageSchema,
} from './schemas/email-quota.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

const models = MongooseModule.forFeature([
  { name: User.name, schema: UserSchema },
  { name: Credential.name, schema: CredentialSchema },
  { name: OtpCode.name, schema: OtpCodeSchema },
  { name: Session.name, schema: SessionSchema },
  { name: WebauthnChallenge.name, schema: WebauthnChallengeSchema },
  { name: EmailQuotaUsage.name, schema: EmailQuotaUsageSchema },
  { name: AuditLog.name, schema: AuditLogSchema },
]);

@Global()
@Module({
  imports: [models],
  exports: [models],
})
export class DatabaseModule {}
