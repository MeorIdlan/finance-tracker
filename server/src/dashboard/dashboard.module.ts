import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { CreditCardsModule } from '../credit-cards/credit-cards.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [AuthGuardModule, CreditCardsModule, TransactionsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
