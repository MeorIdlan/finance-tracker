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

  it('returns most recent 24 months when history exceeds 24 months', async () => {
    const { getModelToken } = require('@nestjs/mongoose');
    const NetWorthSnapshot = require('../src/database/schemas/net-worth-snapshot.schema')
      .NetWorthSnapshot;
    const model = ctx.app.get(getModelToken(NetWorthSnapshot.name));

    // Get user ID from the seeded user
    const User = require('../src/database/schemas/user.schema').User;
    const userModel = ctx.app.get(getModelToken(User.name));
    const user = await userModel.findOne({ email: 'trend@user.com' });
    const userId = user._id;

    // Seed 30 months of data (oldest first)
    const baseDate = new Date(2024, 0, 1); // January 2024
    const snapshots = [];
    for (let i = 0; i < 30; i++) {
      const month = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
      const monthStr = month.toISOString().slice(0, 7);
      snapshots.push({
        userId,
        month: monthStr,
        value: 100000 + i * 1000, // increasing value over time
        computedAt: new Date(),
      });
    }
    await model.insertMany(snapshots);

    // Call the endpoint
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/net-worth-trend')
      .set('Cookie', cookie)
      .expect(200);

    // Should have at most 24 entries
    expect(res.body.length).toBeLessThanOrEqual(24);

    // Should include the current month (most recent)
    const months = res.body.map((p: { month: string }) => p.month);
    expect(months).toContain(thisMonth);

    // Should be in ascending order
    for (let i = 1; i < res.body.length; i++) {
      expect(res.body[i].month >= res.body[i - 1].month).toBe(true);
    }

    // Should NOT include the oldest months (months 0-5)
    const oldestMonths = snapshots.slice(0, 6).map((s) => s.month);
    const returnedMonths = new Set(months);
    for (const old of oldestMonths) {
      expect(returnedMonths).not.toContain(old);
    }
  });
});
