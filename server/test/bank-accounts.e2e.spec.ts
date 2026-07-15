import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';
import { Transaction } from '../src/database/schemas/transaction.schema';

describe('bank accounts', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let userId: Types.ObjectId;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie, userId } = await seedAuthedUser(ctx.app));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('creates an account with currentBalance = openingBalance', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/accounts/bank')
      .set('Cookie', cookie)
      .send({ name: 'Maybank', openingBalance: 150000 })
      .expect(201);
    expect(res.body.currentBalance).toBe(150000);
    expect(res.body.name).toBe('Maybank');
  });

  it('lists only the owners accounts', async () => {
    const other = await seedAuthedUser(ctx.app, 'other@user.com');
    await request(ctx.app.getHttpServer())
      .post('/api/accounts/bank')
      .set('Cookie', other.cookie)
      .send({ name: 'Other Bank', openingBalance: 0 });
    const res = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Maybank');
  });

  it('renames an account', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    const id = list.body[0].id;
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/accounts/bank/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Maybank Savings' })
      .expect(200);
    expect(res.body.name).toBe('Maybank Savings');
  });

  it('404s updates to another users account', async () => {
    const other = await seedAuthedUser(ctx.app, 'third@user.com');
    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    await request(ctx.app.getHttpServer())
      .patch(`/api/accounts/bank/${list.body[0].id}`)
      .set('Cookie', other.cookie)
      .send({ name: 'hijack' })
      .expect(404);
  });

  it('blocks deleting an account with transactions, allows otherwise', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    const id = list.body[0].id;
    const txnModel: Model<Transaction> = ctx.app.get(
      getModelToken(Transaction.name),
    );
    const txn = await txnModel.create({
      userId,
      type: 'income',
      amount: 1000,
      date: new Date(),
      sourceType: 'bankAccount',
      sourceId: new Types.ObjectId(id),
    });
    await request(ctx.app.getHttpServer())
      .delete(`/api/accounts/bank/${id}`)
      .set('Cookie', cookie)
      .expect(409);
    await txn.deleteOne();
    await request(ctx.app.getHttpServer())
      .delete(`/api/accounts/bank/${id}`)
      .set('Cookie', cookie)
      .expect(200);
  });
});
