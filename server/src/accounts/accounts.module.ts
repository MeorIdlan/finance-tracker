import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { AuditModule } from '../audit/audit.module';
import { BankAccountsService } from './bank-accounts.service';
import { BankAccountsController } from './bank-accounts.controller';
import { SavingsAccountsService } from './savings-accounts.service';
import { SavingsAccountsController } from './savings-accounts.controller';

@Module({
  imports: [AuthGuardModule, AuditModule],
  controllers: [BankAccountsController, SavingsAccountsController],
  providers: [BankAccountsService, SavingsAccountsService],
  exports: [BankAccountsService, SavingsAccountsService],
})
export class AccountsModule {}
