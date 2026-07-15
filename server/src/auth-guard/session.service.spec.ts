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

  describe('sliding expiration', () => {
    it('does not renew a full session that is well within its TTL', async () => {
      const user = await userModel.create({
        email: 'sliding-fresh@b.com',
        emailVerified: true,
      });
      const token = await service.create(user._id, 'full');
      const before = await sessionModel
        .findOne({ userId: user._id })
        .lean();

      const info = await service.validate(token);

      expect(info!.renewed).toBe(false);
      const after = await sessionModel.findOne({ userId: user._id }).lean();
      expect(after!.expiresAt.getTime()).toBe(before!.expiresAt.getTime());
    });

    it('renews a full session past the halfway point of its TTL', async () => {
      const user = await userModel.create({
        email: 'sliding-stale@b.com',
        emailVerified: true,
      });
      const token = await service.create(user._id, 'full');
      const doc = await sessionModel.findOne({ userId: user._id });
      // fullTtlMs defaults to 30 days; push remaining time to 5 days (< half)
      const staleExpiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await sessionModel.updateOne(
        { _id: doc!._id },
        { expiresAt: staleExpiresAt },
      );

      const info = await service.validate(token);

      expect(info!.renewed).toBe(true);
      const after = await sessionModel.findOne({ _id: doc!._id }).lean();
      expect(after!.expiresAt.getTime()).toBeGreaterThan(
        staleExpiresAt.getTime(),
      );
      // renewed to ~fullTtlMs from now (30 days), not just past the old expiry
      const expectedFloor = Date.now() + 25 * 24 * 60 * 60 * 1000;
      expect(after!.expiresAt.getTime()).toBeGreaterThan(expectedFloor);
    });

    it('never renews a pending session, even near expiry', async () => {
      const user = await userModel.create({
        email: 'sliding-pending@b.com',
        emailVerified: true,
      });
      const token = await service.create(user._id, 'pending_passkey');
      const doc = await sessionModel.findOne({ userId: user._id });
      const nearExpiry = new Date(Date.now() + 1000);
      await sessionModel.updateOne(
        { _id: doc!._id },
        { expiresAt: nearExpiry },
      );

      const info = await service.validate(token);

      expect(info!.renewed).toBe(false);
      const after = await sessionModel.findOne({ _id: doc!._id }).lean();
      expect(after!.expiresAt.getTime()).toBe(nearExpiry.getTime());
    });
  });
});
