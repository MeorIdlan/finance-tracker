import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

describe('agent token status/rotate', () => {
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
    await request(server).get('/api/agent-token/status').expect(401);
    await request(server).post('/api/agent-token/rotate').expect(401);
  });

  it('reports no token before any rotate', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/agent-token/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toEqual({ hasToken: false, createdAt: null, lastUsedAt: null });
  });

  it('rotate returns a plaintext token once, then status reflects it', async () => {
    const server = ctx.app.getHttpServer();
    const rotateRes = await request(server)
      .post('/api/agent-token/rotate')
      .set('Cookie', cookie)
      .expect(201);
    expect(rotateRes.body.token).toMatch(/^ftk_/);

    const statusRes = await request(server)
      .get('/api/agent-token/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(statusRes.body.hasToken).toBe(true);
    expect(statusRes.body.token).toBeUndefined();
  });

  it('rotating again invalidates the previous token for MCP auth', async () => {
    const server = ctx.app.getHttpServer();
    const first = (
      await request(server).post('/api/agent-token/rotate').set('Cookie', cookie)
    ).body.token;
    const second = (
      await request(server).post('/api/agent-token/rotate').set('Cookie', cookie)
    ).body.token;
    expect(second).not.toBe(first);
  });
});
