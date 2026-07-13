import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthController } from './health/health.controller';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { PasskeysModule } from './passkeys/passkeys.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
