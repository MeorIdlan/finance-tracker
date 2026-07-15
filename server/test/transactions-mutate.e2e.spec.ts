import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('transaction update/delete/list', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let accountId: string;

  async function balance(): Promise<number> {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    return res.body[0].currentBalance;
  }

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'mut@user.com'));
    accountId = (
      await request(ctx.app.getHttpServer())
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Main', openingBalance: 100000 })
    ).body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('editing the amount shifts the balance by the delta', async () => {
    const txn = (
      await request(ctx.app.getHttpServer())
        .post('/api/transactions')
        .set('Cookie', cookie)
        .send({
          type: 'expense',
          amount: 10000,
          date: '2026-07-01',
          sourceType: 'bankAccount',
          sourceId: accountId,
          category: 'Food',
        })
    ).body;
    expect(await balance()).toBe(90000);

    await request(ctx.app.getHttpServer())
      .patch(`/api/transactions/${txn.id}`)
      .set('Cookie', cookie)
      .send({ amount: 4000 })
      .expect(200);
    expect(await balance()).toBe(96000);
  });

  it('deleting a transaction restores the balance', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/transactions')
      .set('Cookie', cookie);
    await request(ctx.app.getHttpServer())
      .delete(`/api/transactions/${list.body.items[0].id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(await balance()).toBe(100000);
  });

  it('filters by type, category, and date range with pagination', async () => {
    const server = ctx.app.getHttpServer();
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'income',
        amount: 1000,
        date: '2026-06-01',
        sourceType: 'bankAccount',
        sourceId: accountId,
      });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 500,
        date: '2026-07-05',
        sourceType: 'bankAccount',
        sourceId: accountId,
        category: 'Transport',
      });
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 700,
        date: '2026-07-06',
        sourceType: 'bankAccount',
        sourceId: accountId,
        category: 'Food',
      });

    const byType = await request(server)
      .get('/api/transactions?type=expense')
      .set('Cookie', cookie)
      .expect(200);
    expect(byType.body.total).toBe(2);

    const byCategory = await request(server)
      .get('/api/transactions?category=Food')
      .set('Cookie', cookie);
    expect(byCategory.body.total).toBe(1);

    const byDate = await request(server)
      .get('/api/transactions?from=2026-07-01&to=2026-07-31')
      .set('Cookie', cookie);
    expect(byDate.body.total).toBe(2);

    const paged = await request(server)
      .get('/api/transactions?page=1&pageSize=2')
      .set('Cookie', cookie);
    expect(paged.body.items).toHaveLength(2);
    expect(paged.body.total).toBe(3);
    // newest date first
    expect(paged.body.items[0].date).toContain('2026-07-06');
  });

  it('rejects editing immutable fields via whitelist stripping', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/transactions')
      .set('Cookie', cookie);
    const txn = list.body.items.find(
      (t: { type: string }) => t.type === 'expense',
    );
    // type is not in UpdateTransactionDto; whitelist:true strips it silently,
    // so the type must remain unchanged.
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/transactions/${txn.id}`)
      .set('Cookie', cookie)
      .send({ type: 'income', amount: txn.amount })
      .expect(200);
    expect(res.body.type).toBe('expense');
  });
});
