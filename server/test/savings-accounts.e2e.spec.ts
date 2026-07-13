import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('savings/investment accounts', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let accountId: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'sav@user.com'));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('creates an investment account with null latest value', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/accounts/savings')
      .set('Cookie', cookie)
      .send({ name: 'ASB', type: 'investment' })
      .expect(201);
    accountId = res.body.id;
    expect(res.body.latestValue).toBeNull();
  });

  it('logs snapshots and surfaces the latest on the list', async () => {
    await request(ctx.app.getHttpServer())
      .post(`/api/accounts/savings/${accountId}/snapshots`)
      .set('Cookie', cookie)
      .send({ date: '2026-06-30', value: 1000000 })
      .expect(201);
    await request(ctx.app.getHttpServer())
      .post(`/api/accounts/savings/${accountId}/snapshots`)
      .set('Cookie', cookie)
      .send({ date: '2026-07-31', value: 1050000 })
      .expect(201);

    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/savings')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body[0].latestValue).toBe(1050000);
    expect(list.body[0].latestValueDate).toContain('2026-07-31');

    const snaps = await request(ctx.app.getHttpServer())
      .get(`/api/accounts/savings/${accountId}/snapshots`)
      .set('Cookie', cookie)
      .expect(200);
    expect(snaps.body).toHaveLength(2);
    expect(snaps.body[0].value).toBe(1050000);
  });

  it('404s snapshots on another users account', async () => {
    const other = await seedAuthedUser(ctx.app, 'sav2@user.com');
    await request(ctx.app.getHttpServer())
      .post(`/api/accounts/savings/${accountId}/snapshots`)
      .set('Cookie', other.cookie)
      .send({ date: '2026-07-01', value: 1 })
      .expect(404);
  });

  it('deletes the account together with its snapshots', async () => {
    await request(ctx.app.getHttpServer())
      .delete(`/api/accounts/savings/${accountId}`)
      .set('Cookie', cookie)
      .expect(200);
    const list = await request(ctx.app.getHttpServer())
      .get('/api/accounts/savings')
      .set('Cookie', cookie);
    expect(list.body).toHaveLength(0);
  });
});
