import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('dashboard trend endpoints', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  const thisMonth = new Date().toISOString().slice(0, 7);

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'trend@user.com'));
    const server = ctx.app.getHttpServer();
    const bank = (
      await request(server)
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Main', openingBalance: 1000000 })
    ).body;
    const today = new Date().toISOString().slice(0, 10);
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'expense', amount: 3000, date: today, accountId: bank.id, category: 'Food' });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'expense', amount: 2000, date: today, accountId: bank.id, category: 'Food' });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'expense', amount: 7000, date: today, accountId: bank.id, category: 'Transport' });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'income', amount: 99999, date: today, accountId: bank.id });
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('spending by category sums expenses only, in category order', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/dashboard/spending-by-category?month=${thisMonth}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toEqual([
      { category: 'Food', total: 5000 },
      { category: 'Transport', total: 7000 },
    ]);
  });

  it('spending trend groups by month and excludes income', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/spending-trend?months=3')
      .set('Cookie', cookie)
      .expect(200);
    const current = res.body.find(
      (p: { month: string }) => p.month === thisMonth,
    );
    expect(current.value).toBe(12000);
  });

  it('net worth trend lazily records the current month', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/net-worth-trend')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].month).toBe(thisMonth);
    // 1,000,000 - 12,000 spending + 99,999 income
    expect(res.body[0].value).toBe(1087999);

    // calling again updates rather than duplicates
    const again = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/net-worth-trend')
      .set('Cookie', cookie);
    expect(again.body).toHaveLength(1);
  });
});
