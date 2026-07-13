import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { Model } from 'mongoose';
import { DatabaseModule } from '../database/database.module';
import { EmailQuotaUsage } from '../database/schemas/email-quota.schema';
import { EmailService } from './email.service';
import { startMemoryMongo } from '../../test/utils/mongo';

const sendMock = jest.fn().mockResolvedValue(undefined);
jest.mock('mailersend', () => {
  class EmailParams {
    setFrom() { return this; }
    setTo() { return this; }
    setSubject() { return this; }
    setText() { return this; }
  }
  return {
    MailerSend: jest.fn().mockImplementation(() => ({
      email: { send: sendMock },
    })),
    EmailParams,
    Sender: jest.fn(),
    Recipient: jest.fn(),
  };
});

describe('EmailService', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let service: EmailService;
  let quotaModel: Model<EmailQuotaUsage>;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.uri), DatabaseModule],
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: unknown) =>
              ({
                MAILERSEND_API_KEY: 'test-key',
                MAILERSEND_FROM_EMAIL: 'noreply@test.com',
                EMAIL_MONTHLY_QUOTA: '3',
              })[key] ?? def,
            getOrThrow: (key: string) =>
              ({
                MAILERSEND_API_KEY: 'test-key',
                MAILERSEND_FROM_EMAIL: 'noreply@test.com',
              })[key],
          },
        },
      ],
    }).compile();
    service = moduleRef.get(EmailService);
    quotaModel = moduleRef.get(getModelToken(EmailQuotaUsage.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  it('sends and increments the monthly counter', async () => {
    await service.sendOtpEmail('a@b.com', '123456');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const row = await quotaModel.findOne().lean();
    expect(row!.count).toBe(1);
  });

  it('hard-stops once quota is reached', async () => {
    await service.sendOtpEmail('a@b.com', '123456');
    await service.sendOtpEmail('a@b.com', '123456');
    await expect(service.sendOtpEmail('a@b.com', '123456')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(sendMock).toHaveBeenCalledTimes(3);
  });
});
