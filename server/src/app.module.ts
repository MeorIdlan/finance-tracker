import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health/health.controller';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { PasskeysModule } from './passkeys/passkeys.module';
import { AccountsModule } from './accounts/accounts.module';
import { CommitmentsModule } from './commitments/commitments.module';
import { LoansModule } from './loans/loans.module';
import { CreditCardsModule } from './credit-cards/credit-cards.module';
import { TransactionsModule } from './transactions/transactions.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AgentModule } from './agent/agent.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    DatabaseModule,
    AuditModule,
    EmailModule,
    AuthModule,
    PasskeysModule,
    AccountsModule,
    CommitmentsModule,
    LoansModule,
    CreditCardsModule,
    TransactionsModule,
    DashboardModule,
    AgentModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
