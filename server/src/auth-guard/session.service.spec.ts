import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { DatabaseModule } from '../database/database.module';
import { User } from '../database/schemas/user.schema';
import { Session } from '../database/schemas/session.schema';
import { SessionService } from './session.service';
import { startMemoryMongo } from '../../test/utils/mongo';

describe('SessionService', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let service: SessionService;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.uri), DatabaseModule],
      providers: [
        SessionService,
        {
          provide: ConfigService,
          useValue: { get: (_k: string, def?: unknown) => def },
        },
      ],
    }).compile();
    service = moduleRef.get(SessionService);
    userModel = moduleRef.get(getModelToken(User.name));
    sessionModel = moduleRef.get(getModelToken(Session.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  it('creates, validates, upgrades, and destroys a session', async () => {
    const user = await userModel.create({
      email: 's@b.com',
      emailVerified: true,
    });
    const token = await service.create(user._id, 'pending_passkey');
    expect(token.length).toBeGreaterThanOrEqual(32);

    const info = await service.validate(token);
    expect(info).not.toBeNull();
    expect(info!.scope).toBe('pending_passkey');
    expect(info!.email).toBe('s@b.com');

    await service.upgrade(info!.sessionId);
    expect((await service.validate(token))!.scope).toBe('full');

    await service.destroy(token);
    expect(await service.validate(token)).toBeNull();
  });

  it('stores only a token hash and rejects expired sessions', async () => {
    const user = await userModel.findOne();
    const token = await service.create(user!._id, 'full');
    const doc = await sessionModel.findOne({}).sort({ createdAt: -1 }).lean();
    expect(doc!.tokenHash).not.toBe(token);
    await sessionModel.updateOne(
      { _id: doc!._id },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    expect(await service.validate(token)).toBeNull();
  });
});
