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
import { BankAccount, BankAccountSchema } from './schemas/bank-account.schema';
import {
  SavingsAccount,
  SavingsAccountSchema,
} from './schemas/savings-account.schema';
import {
  ValueSnapshot,
  ValueSnapshotSchema,
} from './schemas/value-snapshot.schema';
import { Commitment, CommitmentSchema } from './schemas/commitment.schema';
import { Loan, LoanSchema } from './schemas/loan.schema';
import { CreditCard, CreditCardSchema } from './schemas/credit-card.schema';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';

const models = MongooseModule.forFeature([
  { name: User.name, schema: UserSchema },
  { name: Credential.name, schema: CredentialSchema },
  { name: OtpCode.name, schema: OtpCodeSchema },
  { name: Session.name, schema: SessionSchema },
  { name: WebauthnChallenge.name, schema: WebauthnChallengeSchema },
  { name: EmailQuotaUsage.name, schema: EmailQuotaUsageSchema },
  { name: AuditLog.name, schema: AuditLogSchema },
  { name: BankAccount.name, schema: BankAccountSchema },
  { name: SavingsAccount.name, schema: SavingsAccountSchema },
  { name: ValueSnapshot.name, schema: ValueSnapshotSchema },
  { name: Commitment.name, schema: CommitmentSchema },
  { name: Loan.name, schema: LoanSchema },
  { name: CreditCard.name, schema: CreditCardSchema },
  { name: Transaction.name, schema: TransactionSchema },
]);

@Global()
@Module({
  imports: [models],
  exports: [models],
})
export class DatabaseModule {}
