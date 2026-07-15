import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';
import { BankAccount } from '../src/database/schemas/bank-account.schema';

describe('balance recompute', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let accountId: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'rc@user.com'));
    const server = ctx.app.getHttpServer();
    accountId = (
      await request(server)
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Main', openingBalance: 100000 })
    ).body.id;
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'income',
        amount: 50000,
        date: '2026-07-01',
        sourceType: 'bankAccount',
        sourceId: accountId,
      });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 20000,
        date: '2026-07-02',
        sourceType: 'bankAccount',
        sourceId: accountId,
        category: 'Bills',
      });
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('reports zero drift when balances are consistent', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/accounts/bank/${accountId}/recompute`)
      .set('Cookie', cookie)
      .expect(201);
    expect(res.body).toEqual({ currentBalance: 130000, drift: 0 });
  });

  it('repairs a corrupted stored balance and reports the drift', async () => {
    const model: Model<BankAccount> = ctx.app.get(
      getModelToken(BankAccount.name),
    );
    await model.updateOne({}, { currentBalance: 999999 });
    const res = await request(ctx.app.getHttpServer())
      .post(`/api/accounts/bank/${accountId}/recompute`)
      .set('Cookie', cookie)
      .expect(201);
    expect(res.body.currentBalance).toBe(130000);
    expect(res.body.drift).toBe(130000 - 999999);
    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    expect(list.body[0].currentBalance).toBe(130000);
  });
});
