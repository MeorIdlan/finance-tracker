import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ApiToken, ApiTokenSchema } from './api-token.schema';

describe('ApiToken schema', () => {
  let mongod: MongoMemoryReplSet;
  let model: Model<ApiToken>;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri('agent-token-test')),
        MongooseModule.forFeature([{ name: ApiToken.name, schema: ApiTokenSchema }]),
      ],
    }).compile();
    model = moduleRef.get(getModelToken(ApiToken.name));
  });

  afterAll(async () => {
    await mongod.stop();
  });

  it('enforces one token document per user', async () => {
    const userId = new Types.ObjectId();
    await model.create({ userId, tokenHash: 'hash-1', createdAt: new Date() });
    await expect(
      model.create({ userId, tokenHash: 'hash-2', createdAt: new Date() }),
    ).rejects.toThrow();
  });
});
