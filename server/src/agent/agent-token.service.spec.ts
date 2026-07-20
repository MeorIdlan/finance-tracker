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

  it('status reports no token before rotate is ever called', async () => {
    const userId = new Types.ObjectId().toHexString();
    const status = await service.status(userId);
    expect(status).toEqual({ hasToken: false, createdAt: null, lastUsedAt: null });
  });

  it('rotate creates a plaintext token resolvable via resolve()', async () => {
    const userId = new Types.ObjectId().toHexString();
    const token = await service.rotate(userId);
    expect(typeof token).toBe('string');
    expect(token.startsWith('ftk_')).toBe(true);

    const resolved = await service.resolve(token);
    expect(resolved).toEqual({ userId });

    const status = await service.status(userId);
    expect(status.hasToken).toBe(true);
    expect(status.createdAt).not.toBeNull();
  });

  it('rotating again invalidates the previous token', async () => {
    const userId = new Types.ObjectId().toHexString();
    const first = await service.rotate(userId);
    const second = await service.rotate(userId);
    expect(second).not.toBe(first);
    expect(await service.resolve(first)).toBeNull();
    expect(await service.resolve(second)).toEqual({ userId });
  });

  it('resolve returns null for an unknown token', async () => {
    expect(await service.resolve('ftk_does-not-exist')).toBeNull();
  });
});
