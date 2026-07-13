import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';
import { CreditCard } from '../src/database/schemas/credit-card.schema';

describe('loans and credit cards', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'lc@user.com'));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('creates a loan defaulting currentBalance to principal', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/loans')
      .set('Cookie', cookie)
      .send({ name: 'Car loan', principal: 5000000, interestRate: 3.5 })
      .expect(201);
    expect(res.body.currentBalance).toBe(5000000);
  });

  it('creates a loan with an explicit mid-life balance', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/loans')
      .set('Cookie', cookie)
      .send({
        name: 'Study loan',
        principal: 3000000,
        interestRate: 1.0,
        currentBalance: 1200000,
      })
      .expect(201);
    expect(res.body.currentBalance).toBe(1200000);
  });

  it('creates a credit card with zero balances', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/credit-cards')
      .set('Cookie', cookie)
      .send({ name: 'Visa', creditLimit: 1000000, statementDay: 5, dueDay: 25 })
      .expect(201);
    expect(res.body.currentBalance).toBe(0);
    expect(res.body.statementBalance).toBe(0);
  });

  it('rolls the statement lazily when a statement date has passed', async () => {
    const cardModel: Model<CreditCard> = ctx.app.get(
      getModelToken(CreditCard.name),
    );
    // Simulate: charges accrued, and lastStatementAt is two months old.
    await cardModel.updateOne(
      {},
      {
        currentBalance: 45000,
        lastStatementAt: new Date(Date.now() - 62 * 24 * 3600 * 1000),
      },
    );
    const res = await request(ctx.app.getHttpServer())
      .get('/api/credit-cards')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body[0].statementBalance).toBe(45000);
  });

  it('rejects a statementDay above 28', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/credit-cards')
      .set('Cookie', cookie)
      .send({ name: 'Bad', creditLimit: 1, statementDay: 31, dueDay: 25 })
      .expect(400);
  });
});
