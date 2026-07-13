import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreditCardsModule } from '../credit-cards/credit-cards.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [AuthModule, CreditCardsModule, TransactionsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
