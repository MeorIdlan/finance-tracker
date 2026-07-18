import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({
    challenge: 'test-challenge',
  })),
  verifyRegistrationResponse: jest.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'cred-login',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
      },
    },
  })),
  generateAuthenticationOptions: jest.fn(async () => ({
    challenge: 'test-challenge',
  })),
  verifyAuthenticationResponse: jest.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  })),
}));

async function registerWithPasskey(ctx: TestCtx, email: string) {
  const server = ctx.app.getHttpServer();
  await request(server).post('/api/auth/register').send({ name: 'Test User', email });
  const code = ctx.sentCodes.get(email)!;
  const otpRes = await request(server)
    .post('/api/auth/verify-otp')
    .send({ email, code, purpose: 'register' });
  const pendingCookie = otpRes.headers['set-cookie'][0].split(';')[0];
  await request(server)
    .post('/api/auth/passkey/options')
    .set('Cookie', pendingCookie);
  await request(server)
    .post('/api/auth/passkey/verify')
    .set('Cookie', pendingCookie)
    .send({ response: { id: 'cred-login' }, deviceLabel: 'Test' });
  return pendingCookie; // now upgraded to full scope
}

describe('login / logout / me', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    await registerWithPasskey(ctx, 'login@user.com');
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('logs in with a passkey and reaches /me', async () => {
    const server = ctx.app.getHttpServer();
    const optRes = await request(server)
      .post('/api/auth/login/options')
      .send({ email: 'login@user.com' })
      .expect(201);
    expect(optRes.body.challengeId).toBeDefined();

    const verifyRes = await request(server)
      .post('/api/auth/login/verify')
      .send({
        challengeId: optRes.body.challengeId,
        response: { id: 'cred-login' },
      })
      .expect(201);
    const cookie = verifyRes.headers['set-cookie'][0].split(';')[0];

    const me = await request(server)
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body).toEqual({ id: expect.any(String), email: 'login@user.com' });
  });

  it('404s login options for an unknown email', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/login/options')
      .send({ email: 'nobody@user.com' })
      .expect(404);
  });

  it('logout destroys the session', async () => {
    const server = ctx.app.getHttpServer();
    const optRes = await request(server)
      .post('/api/auth/login/options')
      .send({ email: 'login@user.com' });
    const verifyRes = await request(server)
      .post('/api/auth/login/verify')
      .send({
        challengeId: optRes.body.challengeId,
        response: { id: 'cred-login' },
      });
    const cookie = verifyRes.headers['set-cookie'][0].split(';')[0];

    await request(server).post('/api/auth/logout').set('Cookie', cookie).expect(201);
    await request(server).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('401s /me without a cookie', async () => {
    await request(ctx.app.getHttpServer()).get('/api/auth/me').expect(401);
  });
});
