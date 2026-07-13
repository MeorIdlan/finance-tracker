import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DatabaseModule } from '../src/database/database.module';
import { User } from '../src/database/schemas/user.schema';
import { Session } from '../src/database/schemas/session.schema';
import { startMemoryMongo } from './utils/mongo';

describe('database schemas', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.uri), DatabaseModule],
    }).compile();
    userModel = moduleRef.get(getModelToken(User.name));
    sessionModel = moduleRef.get(getModelToken(Session.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  it('round-trips a user and enforces unique email', async () => {
    const user = await userModel.create({ email: 'a@b.com', emailVerified: true });
    expect(user.email).toBe('a@b.com');
    await userModel.ensureIndexes();
    await expect(
      userModel.create({ email: 'a@b.com', emailVerified: false }),
    ).rejects.toThrow();
  });

  it('round-trips a session with scope', async () => {
    const s = await sessionModel.create({
      tokenHash: 'h'.repeat(64),
      userId: (await userModel.findOne())!._id,
      scope: 'pending_passkey',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(s.scope).toBe('pending_passkey');
  });
});
