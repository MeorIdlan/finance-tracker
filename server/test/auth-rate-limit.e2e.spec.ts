import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';

describe('register/recover rate limiting', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('blocks the 6th register request within an hour for the same IP+email', async () => {
    for (let i = 0; i < 5; i++) {
      await request(ctx.app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: 'ratelimit@user.com' })
        .expect(201);
    }
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'ratelimit@user.com' })
      .expect(429);
  });

  it('does not block a different email from the same client', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/recover')
      .send({ email: 'ratelimit@user.com' })
      .expect(429);
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'different@user.com' })
      .expect(201);
  });

  // Regression test for trust proxy config (server/src/main.ts). All requests
  // in this suite originate from the same loopback socket, so the throttler's
  // IP+email tracker can only distinguish "clients" via X-Forwarded-For if the
  // app trusts the proxy chain (app.set('trust proxy', true) in test/utils/app.ts,
  // mirroring main.ts). Without that setting, req.ip would resolve to the same
  // loopback address regardless of X-Forwarded-For, and the second email below
  // would incorrectly share the first client's exhausted bucket.
  it('treats requests with distinct X-Forwarded-For client IPs as separate throttle buckets', async () => {
    const email = 'xff-rate-limit@user.com';
    for (let i = 0; i < 5; i++) {
      await request(ctx.app.getHttpServer())
        .post('/api/auth/register')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ email })
        .expect(201);
    }
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ email })
      .expect(429);

    // A different simulated client IP, same email, is not blocked.
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .set('X-Forwarded-For', '203.0.113.20')
      .send({ email })
      .expect(201);
  });
});
