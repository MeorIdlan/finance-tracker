import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('commitments', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'com@user.com'));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('creates a commitment with a computed next due date and status', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/commitments')
      .set('Cookie', cookie)
      .send({ name: 'Rent', amount: 150000, dueDayOfMonth: 1 })
      .expect(201);
    expect(res.body.nextDueDate).toBeDefined();
    expect(['overdue', 'dueSoon', 'upcoming']).toContain(res.body.status);
    expect(new Date(res.body.nextDueDate).getUTCDate()).toBeLessThanOrEqual(31);
  });

  it('alreadyPaidThisPeriod shifts nextDueDate one period beyond a normal commitment', async () => {
    const server = ctx.app.getHttpServer();
    const normal = await request(server)
      .post('/api/commitments')
      .set('Cookie', cookie)
      .send({ name: 'Water', amount: 5000, dueDayOfMonth: 1 })
      .expect(201);
    const paid = await request(server)
      .post('/api/commitments')
      .set('Cookie', cookie)
      .send({
        name: 'Water Paid',
        amount: 5000,
        dueDayOfMonth: 1,
        alreadyPaidThisPeriod: true,
      })
      .expect(201);
    const normalDate = new Date(normal.body.nextDueDate);
    const paidDate = new Date(paid.body.nextDueDate);
    const monthsApart =
      (paidDate.getUTCFullYear() - normalDate.getUTCFullYear()) * 12 +
      (paidDate.getUTCMonth() - normalDate.getUTCMonth());
    expect(monthsApart).toBe(1);
  });

  it('updates amount and recomputes due date when the day changes', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/commitments')
      .set('Cookie', cookie);
    const id = list.body[0].id;
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/commitments/${id}`)
      .set('Cookie', cookie)
      .send({ amount: 160000, dueDayOfMonth: 15 })
      .expect(200);
    expect(res.body.amount).toBe(160000);
    expect(new Date(res.body.nextDueDate).getUTCDate()).toBe(15);
  });

  it('deactivates a commitment', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/commitments')
      .set('Cookie', cookie);
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/commitments/${list.body[0].id}`)
      .set('Cookie', cookie)
      .send({ active: false })
      .expect(200);
    expect(res.body.active).toBe(false);
  });

  it('deletes an unreferenced commitment', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/commitments')
      .set('Cookie', cookie);
    await request(ctx.app.getHttpServer())
      .delete(`/api/commitments/${list.body[0].id}`)
      .set('Cookie', cookie)
      .expect(200);
  });
});
