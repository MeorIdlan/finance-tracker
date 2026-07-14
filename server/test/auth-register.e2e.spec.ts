import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';

describe('registration and recovery flow', () => {
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

  it('registers: email -> otp -> pending session cookie', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'new@user.com' })
      .expect(201);
    const code = ctx.sentCodes.get('new@user.com')!;
    expect(code).toMatch(/^\d{6}$/);

    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ email: 'new@user.com', code, purpose: 'register' })
      .expect(201);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('sid=');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(res.body.scope).toBe('pending_passkey');
  });

  it('rejects a wrong otp with 401', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'two@user.com' })
      .expect(201);
    await request(ctx.app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ email: 'two@user.com', code: '000000', purpose: 'register' })
      .expect(401);
  });

  it('returns 409 when registering an already-verified email', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'new@user.com' })
      .expect(409);
  });

  it('recover: 201 for verified user, 404 for unknown', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/recover')
      .send({ email: 'new@user.com' })
      .expect(201);
    await request(ctx.app.getHttpServer())
      .post('/api/auth/recover')
      .send({ email: 'ghost@user.com' })
      .expect(404);
  });

  it('rejects an invalid email with 400', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'not-an-email' })
      .expect(400);
  });
});
