import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DatabaseModule } from '../database/database.module';
import { OtpCode } from '../database/schemas/otp-code.schema';
import { OtpService } from './otp.service';
import { startMemoryMongo } from '../../test/utils/mongo';

describe('OtpService', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let service: OtpService;
  let otpModel: Model<OtpCode>;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.uri), DatabaseModule],
      providers: [OtpService],
    }).compile();
    service = moduleRef.get(OtpService);
    otpModel = moduleRef.get(getModelToken(OtpCode.name));
  });

  afterEach(async () => {
    await otpModel.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  it('issues a 6-digit code and verifies it once', async () => {
    const code = await service.issue('a@b.com', 'register');
    expect(code).toMatch(/^\d{6}$/);
    expect(await service.verify('a@b.com', 'register', code)).toBe(true);
    expect(await service.verify('a@b.com', 'register', code)).toBe(false);
  });

  it('stores only a hash, never the plaintext', async () => {
    const code = await service.issue('a@b.com', 'register');
    const doc = await otpModel.findOne().lean();
    expect(doc!.codeHash).not.toContain(code);
  });

  it('re-issuing replaces the previous code', async () => {
    const first = await service.issue('a@b.com', 'register');
    const second = await service.issue('a@b.com', 'register');
    expect(await service.verify('a@b.com', 'register', first)).toBe(false);
    expect(await service.verify('a@b.com', 'register', second)).toBe(true);
  });

  it('locks out after 5 wrong attempts', async () => {
    const code = await service.issue('a@b.com', 'register');
    for (let i = 0; i < 5; i++) {
      expect(await service.verify('a@b.com', 'register', '000000')).toBe(false);
    }
    expect(await service.verify('a@b.com', 'register', code)).toBe(false);
  });

  it('rejects an expired code', async () => {
    const code = await service.issue('a@b.com', 'register');
    await otpModel.updateOne({}, { expiresAt: new Date(Date.now() - 1000) });
    expect(await service.verify('a@b.com', 'register', code)).toBe(false);
  });
});
