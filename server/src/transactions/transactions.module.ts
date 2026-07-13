import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { LoansModule } from '../loans/loans.module';
import { CreditCardsModule } from '../credit-cards/credit-cards.module';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';

@Module({
  imports: [
    AuthModule,
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
