import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { BankAccountsService } from './bank-accounts.service';
import { BankAccountsController } from './bank-accounts.controller';
import { SavingsAccountsService } from './savings-accounts.service';
import { SavingsAccountsController } from './savings-accounts.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [BankAccountsController, SavingsAccountsController],
  providers: [BankAccountsService, SavingsAccountsService],
  exports: [BankAccountsService, SavingsAccountsService],
})
export class AccountsModule {}
