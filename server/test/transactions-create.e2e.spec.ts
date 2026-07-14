import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

async function getBank(ctx: TestCtx, cookie: string) {
  const res = await request(ctx.app.getHttpServer())
    .get('/api/accounts/bank')
    .set('Cookie', cookie);
  return res.body;
}

describe('transaction creation effects', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let accountId: string;
  let toAccountId: string;
  let commitmentId: string;
  let loanId: string;
  let cardId: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'tx@user.com'));
    const server = ctx.app.getHttpServer();
    accountId = (
      await request(server)
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Main', openingBalance: 500000 })
    ).body.id;
    toAccountId = (
      await request(server)
        .post('/api/accounts/bank')
        .set('Cookie', cookie)
        .send({ name: 'Side', openingBalance: 0 })
    ).body.id;
    commitmentId = (
      await request(server)
        .post('/api/commitments')
        .set('Cookie', cookie)
        .send({ name: 'Rent', amount: 150000, dueDayOfMonth: 1 })
    ).body.id;
    loanId = (
      await request(server)
        .post('/api/loans')
        .set('Cookie', cookie)
        .send({ name: 'Car', principal: 5000000, interestRate: 3.5 })
    ).body.id;
    cardId = (
      await request(server)
        .post('/api/credit-cards')
        .set('Cookie', cookie)
        .send({ name: 'Visa', creditLimit: 1000000, statementDay: 5, dueDay: 25 })
    ).body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('income increases the account balance', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'income', amount: 300000, date: '2026-07-01', accountId })
      .expect(201);
    const banks = await getBank(ctx, cookie);
    expect(banks.find((b: { id: string }) => b.id === accountId).currentBalance).toBe(
      800000,
    );
  });

  it('expense requires a category and decreases the balance', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'expense', amount: 5000, date: '2026-07-02', accountId })
      .expect(400);
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'expense',
        amount: 5000,
        date: '2026-07-02',
        accountId,
        category: 'Food',
      })
      .expect(201);
    const banks = await getBank(ctx, cookie);
    expect(banks.find((b: { id: string }) => b.id === accountId).currentBalance).toBe(
      795000,
    );
  });

  it('transfer moves money between accounts', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'transfer',
        amount: 100000,
        date: '2026-07-03',
        accountId,
        toAccountId,
      })
      .expect(201);
    const banks = await getBank(ctx, cookie);
    expect(banks.find((b: { id: string }) => b.id === accountId).currentBalance).toBe(
      695000,
    );
    expect(
      banks.find((b: { id: string }) => b.id === toAccountId).currentBalance,
    ).toBe(100000);
  });

  it('commitmentPayment advances the next due date', async () => {
    const before = (
      await request(ctx.app.getHttpServer())
        .get('/api/commitments')
        .set('Cookie', cookie)
    ).body[0].nextDueDate;
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'commitmentPayment',
        amount: 150000,
        date: '2026-07-01',
        accountId,
        linkedEntityId: commitmentId,
      })
      .expect(201);
    const after = (
      await request(ctx.app.getHttpServer())
        .get('/api/commitments')
        .set('Cookie', cookie)
    ).body[0].nextDueDate;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('loanPayment reduces bank and loan balances', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'loanPayment',
        amount: 80000,
        date: '2026-07-05',
        accountId,
        linkedEntityId: loanId,
      })
      .expect(201);
    const loans = await request(ctx.app.getHttpServer())
      .get('/api/loans')
      .set('Cookie', cookie);
    expect(loans.body[0].currentBalance).toBe(4920000);
  });

  it('cardCharge raises card balance; cardPayment lowers it and the bank', async () => {
    const server = ctx.app.getHttpServer();
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'cardCharge',
        amount: 20000,
        date: '2026-07-06',
        linkedEntityId: cardId,
      })
      .expect(201);
    await request(server)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'cardPayment',
        amount: 15000,
        date: '2026-07-07',
        accountId,
        linkedEntityId: cardId,
      })
      .expect(201);
    const cards = await request(server)
      .get('/api/credit-cards')
      .set('Cookie', cookie);
    expect(cards.body[0].currentBalance).toBe(5000);
  });

  it('rejects transfers to the same account', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({
        type: 'transfer',
        amount: 1,
        date: '2026-07-08',
        accountId,
        toAccountId: accountId,
      })
      .expect(400);
  });

  it('404s a transaction against another users account', async () => {
    const other = await seedAuthedUser(ctx.app, 'tx2@user.com');
    await request(ctx.app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', other.cookie)
      .send({ type: 'income', amount: 1, date: '2026-07-09', accountId })
      .expect(404);
  });
});
