import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { EmailService } from '../../src/email/email.service';

export interface AdminEmailCall {
  adminEmail: string;
  code: string;
  name: string;
  email: string;
}

export interface TestCtx {
  app: INestApplication;
  sentCodes: Map<string, string>;
  adminEmailCalls: AdminEmailCall[];
}

export const TEST_ADMIN_EMAIL = 'admin@test.com';

export async function createTestApp(): Promise<TestCtx> {
  process.env.ADMIN_EMAIL = TEST_ADMIN_EMAIL;
  const sentCodes = new Map<string, string>();
  const adminEmailCalls: AdminEmailCall[] = [];
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useValue({
      sendOtpEmail: async (to: string, code: string) => {
        sentCodes.set(to, code);
      },
      sendRegistrationRequestEmail: async (
        adminEmail: string,
        code: string,
        registrant: { name: string; email: string },
      ) => {
        sentCodes.set(registrant.email, code);
        adminEmailCalls.push({ adminEmail, code, ...registrant });
      },
    })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  // Mirror main.ts's trust proxy setting so e2e tests exercise the same
  // req.ip resolution behavior as production (X-Forwarded-For aware).
  app.set('trust proxy', true);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, sentCodes, adminEmailCalls };
}
