import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { ApiToken, ApiTokenSchema } from '../database/schemas/api-token.schema';
import { AgentTokenService } from './agent-token.service';

describe('AgentTokenService', () => {
  let mongod: MongoMemoryReplSet;
  let service: AgentTokenService;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri('agent-token-service-test')),
        MongooseModule.forFeature([{ name: ApiToken.name, schema: ApiTokenSchema }]),
      ],
      providers: [AgentTokenService],
    }).compile();
    service = moduleRef.get(AgentTokenService);
  });

  afterAll(async () => {
    await mongod.stop();
  });

  it('list is empty before any token is created', async () => {
    const userId = new Types.ObjectId().toHexString();
    expect(await service.list(userId)).toEqual([]);
  });

  it('create returns a plaintext token resolvable via resolve()', async () => {
    const userId = new Types.ObjectId().toHexString();
    const { id, token } = await service.create(userId, 'manual script', 'manual');
    expect(token.startsWith('ftk_')).toBe(true);

    expect(await service.resolve(token)).toEqual({ userId });

    const list = await service.list(userId);
    expect(list).toEqual([
      {
        id,
        label: 'manual script',
        createdAt: expect.any(String),
        lastUsedAt: expect.any(String),
        source: 'manual',
      },
    ]);
  });

  it('creating a second token does not invalidate the first', async () => {
    const userId = new Types.ObjectId().toHexString();
    const first = await service.create(userId, 'first', 'manual');
    const second = await service.create(userId, 'second', 'oauth');

    expect(await service.resolve(first.token)).toEqual({ userId });
    expect(await service.resolve(second.token)).toEqual({ userId });
    expect((await service.list(userId)).map((t) => t.label).sort()).toEqual([
      'first',
      'second',
    ]);
  });

  it('revoke removes only the targeted token', async () => {
    const userId = new Types.ObjectId().toHexString();
    const first = await service.create(userId, 'keep', 'manual');
    const second = await service.create(userId, 'remove', 'manual');

    await service.revoke(userId, second.id);

    expect(await service.resolve(first.token)).toEqual({ userId });
    expect(await service.resolve(second.token)).toBeNull();
    expect((await service.list(userId)).map((t) => t.label)).toEqual(['keep']);
  });

  it('revoke throws for a token belonging to another user', async () => {
    const userId = new Types.ObjectId().toHexString();
    const otherUserId = new Types.ObjectId().toHexString();
    const { id } = await service.create(userId, 'mine', 'manual');

    await expect(service.revoke(otherUserId, id)).rejects.toThrow();
    expect(await service.list(userId)).toHaveLength(1);
  });

  it('resolve returns null for an unknown token', async () => {
    expect(await service.resolve('ftk_does-not-exist')).toBeNull();
  });
});
