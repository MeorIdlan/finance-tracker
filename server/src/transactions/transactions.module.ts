import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { AuditModule } from '../audit/audit.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { LoansModule } from '../loans/loans.module';
import { CreditCardsModule } from '../credit-cards/credit-cards.module';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';

@Module({
  imports: [
    AuthGuardModule,
    AuditModule,
    AccountsModule,
    CommitmentsModule,
    LoansModule,
    CreditCardsModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
