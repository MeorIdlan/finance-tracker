import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('agent token list/create/revoke', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'agent-token@user.com'));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('rejects unauthenticated requests', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).get('/api/agent-token/list').expect(401);
    await request(server).post('/api/agent-token/create').send({ label: 'x' }).expect(401);
    await request(server)
      .delete('/api/agent-token/000000000000000000000000')
      .expect(401);
  });

  it('list is empty before any token is created', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/agent-token/list')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('create returns a plaintext token once, then list reflects it', async () => {
    const server = ctx.app.getHttpServer();
    const createRes = await request(server)
      .post('/api/agent-token/create')
      .set('Cookie', cookie)
      .send({ label: 'manual script' })
      .expect(201);
    expect(createRes.body.token).toMatch(/^ftk_/);

    const listRes = await request(server)
      .get('/api/agent-token/list')
      .set('Cookie', cookie)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0]).toMatchObject({ label: 'manual script', source: 'manual' });
    expect(listRes.body[0].token).toBeUndefined();
  });

  it('creating a second token does not invalidate the first', async () => {
    const server = ctx.app.getHttpServer();
    await request(server)
      .post('/api/agent-token/create')
      .set('Cookie', cookie)
      .send({ label: 'two' });
    const listRes = await request(server).get('/api/agent-token/list').set('Cookie', cookie);
    expect(listRes.body).toHaveLength(2);
  });

  it('revoke removes a token by id and leaves others intact', async () => {
    const server = ctx.app.getHttpServer();
    const listRes = await request(server).get('/api/agent-token/list').set('Cookie', cookie);
    const idToRemove = listRes.body[0].id as string;

    await request(server)
      .delete(`/api/agent-token/${idToRemove}`)
      .set('Cookie', cookie)
      .expect(204);

    const after = await request(server).get('/api/agent-token/list').set('Cookie', cookie);
    expect(after.body.map((t: { id: string }) => t.id)).not.toContain(idToRemove);
    expect(after.body).toHaveLength(1);
  });

  it('rejects a bearer token (no cookie) on cookie-guarded routes', async () => {
    const server = ctx.app.getHttpServer();
    const createRes = await request(server)
      .post('/api/agent-token/create')
      .set('Cookie', cookie)
      .send({ label: 'bearer-test' });
    const token = createRes.body.token;

    await request(server)
      .post('/api/agent-token/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'nope' })
      .expect(401);
  });
});
