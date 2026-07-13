import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('dashboard summary endpoints', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'dash@user.com'));
    const server = ctx.app.getHttpServer();

    const bank = (
      await request(server)
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Main', openingBalance: 500000 })
    ).body;
    const sav = (
      await request(server)
        .post('/api/accounts/savings')
        .set('Cookie', cookie)
        .send({ name: 'ASB', type: 'investment' })
    ).body;
    await request(server)
      .post(`/api/accounts/savings/${sav.id}/snapshots`)
      .set('Cookie', cookie)
      .send({ date: '2026-07-01', value: 1000000 });
    await request(server)
      .post('/api/loans')
      .set('Cookie', cookie)
      .send({ name: 'Car', principal: 300000, interestRate: 3 });
    const card = (
      await request(server)
        .post('/api/credit-cards')
        .set('Cookie', cookie)
        .send({ name: 'Visa', creditLimit: 1000000, statementDay: 5, dueDay: 25 })
    ).body;
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'cardCharge',
        amount: 40000,
        date: new Date().toISOString().slice(0, 10),
        linkedEntityId: card.id,
      });
    await request(server)
      .post('/api/commitments')
      .set('Cookie', cookie)
      .send({ name: 'Rent', amount: 150000, dueDayOfMonth: 1 });
    // one recent expense
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 2500,
        date: new Date().toISOString().slice(0, 10),
        accountId: bank.id,
        category: 'Food',
      });
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('computes the summary', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/summary')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.bankTotal).toBe(497500); // 500000 - 2500 expense
    expect(res.body.savingsTotal).toBe(1000000);
    expect(res.body.loanTotal).toBe(300000);
    expect(res.body.cardTotal).toBe(40000);
    expect(res.body.assets).toBe(1497500);
    expect(res.body.liabilities).toBe(340000);
    expect(res.body.netWorth).toBe(1157500);
  });

  it('lists balance slices for banks and savings', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/balances')
      .set('Cookie', cookie)
      .expect(200);
    const kinds = res.body.map((s: { kind: string }) => s.kind).sort();
    expect(kinds).toEqual(['bank', 'investment']);
  });

  it('lists upcoming bills including the commitment', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/upcoming-bills?days=45')
      .set('Cookie', cookie)
      .expect(200);
    const names = res.body.map((b: { name: string }) => b.name);
    expect(names).toContain('Rent');
    for (const bill of res.body) {
      expect(['overdue', 'dueSoon', 'upcoming']).toContain(bill.status);
    }
  });

  it('returns recent transactions newest first', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/dashboard/recent-transactions?limit=5')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0].date >= res.body[1].date).toBe(true);
  });
});
