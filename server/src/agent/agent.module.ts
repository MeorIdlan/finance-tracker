import { Module } from '@nestjs/common';
import { AuthGuardModule } from '../auth-guard/auth-guard.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { LoansModule } from '../loans/loans.module';
import { CreditCardsModule } from '../credit-cards/credit-cards.module';
import { AgentTokenService } from './agent-token.service';
import { AgentTokenController } from './agent-token.controller';
import { BearerAuthGuard } from './bearer-auth.guard';
import { McpToolsService } from './mcp-tools.service';
import { McpController } from './mcp.controller';

@Module({
  imports: [
    AuthGuardModule,
    TransactionsModule,
    DashboardModule,
    AccountsModule,
    CommitmentsModule,
    LoansModule,
    CreditCardsModule,
  ],
  controllers: [AgentTokenController, McpController],
  providers: [AgentTokenService, BearerAuthGuard, McpToolsService],
  exports: [AgentTokenService, BearerAuthGuard],
})
export class AgentModule {}
