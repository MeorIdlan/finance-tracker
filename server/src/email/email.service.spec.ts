import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { EmailService } from './email.service';

const sendMock = jest.fn().mockResolvedValue(undefined);
const limitGetMock = jest.fn();
jest.mock('mailgun.js', () => {
  return jest.fn().mockImplementation(() => ({
    client: jest.fn().mockImplementation(() => ({
      messages: { create: sendMock },
      customMessageLimit: { get: limitGetMock },
    })),
  }));
});

describe('EmailService', () => {
  let service: EmailService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: unknown) =>
              ({
                MAILGUN_API_KEY: 'test-key',
                MAILGUN_DOMAIN: 'mg.test.com',
                MAILGUN_FROM_EMAIL: 'noreply@test.com',
              })[key] ?? def,
            getOrThrow: (key: string) =>
              ({
                MAILGUN_API_KEY: 'test-key',
                MAILGUN_DOMAIN: 'mg.test.com',
                MAILGUN_FROM_EMAIL: 'noreply@test.com',
              })[key],
          },
        },
      ],
    }).compile();
    service = moduleRef.get(EmailService);
  });

  beforeEach(() => {
    sendMock.mockClear();
    limitGetMock.mockReset();
  });

  it('sends when under the Mailgun account limit', async () => {
    limitGetMock.mockResolvedValue({ limit: 3000, current: 5, period: 'monthly' });
    await service.sendOtpEmail('a@b.com', '123456');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('hard-stops once the Mailgun account limit is reached', async () => {
    limitGetMock.mockResolvedValue({ limit: 3000, current: 3000, period: 'monthly' });
    await expect(service.sendOtpEmail('a@b.com', '123456')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('fails open and still sends if the limit check itself errors', async () => {
    limitGetMock.mockRejectedValue(new Error('network blip'));
    await service.sendOtpEmail('a@b.com', '123456');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('sends a registration request to the given admin email with the registrant name/email/code', async () => {
    limitGetMock.mockResolvedValue({ limit: 3000, current: 5, period: 'monthly' });
    await service.sendRegistrationRequestEmail('admin@test.com', '654321', {
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0];
    expect(call[0]).toBe('mg.test.com');
    expect(call[1].to).toEqual(['admin@test.com']);
    expect(call[1].text).toContain('Jane Doe');
    expect(call[1].text).toContain('jane@example.com');
    expect(call[1].text).toContain('654321');
  });

  it('hard-stops sendRegistrationRequestEmail once the Mailgun account limit is reached', async () => {
    limitGetMock.mockResolvedValue({ limit: 3000, current: 3000, period: 'monthly' });
    await expect(
      service.sendRegistrationRequestEmail('admin@test.com', '654321', {
        name: 'Jane Doe',
        email: 'jane@example.com',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
