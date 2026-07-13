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
});
