import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { Session } from '../src/database/schemas/session.schema';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({
    challenge: 'test-challenge',
  })),
  verifyRegistrationResponse: jest.fn(async (opts: { response: { id: string } }) => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: opts.response.id,
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
  const credentialId = `cred-${email}`;
  await request(server).post('/api/auth/register').send({ email });
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
    .send({ response: { id: credentialId }, deviceLabel: 'Test' });
  return pendingCookie; // now upgraded to full scope
}

describe('session renewal reissues the sid cookie', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let sessionModel: Model<Session>;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    sessionModel = ctx.app.get(getModelToken(Session.name));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('reissues sid with a fresh Max-Age when the session is renewed', async () => {
    const server = ctx.app.getHttpServer();
    const cookie = await registerWithPasskey(ctx, 'renewal@user.com');
    const token = cookie.split('=')[1];

    // Force the session's expiresAt to be stale (< half of the 30-day TTL)
    // so the next validate() call renews it.
    const staleExpiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await sessionModel.updateOne({}, { expiresAt: staleExpiresAt });

    const res = await request(server)
      .get('/api/auth/me')
      .set('Cookie', `sid=${token}`);

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const sidCookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).find(
      (c: string) => c.startsWith('sid='),
    );
    expect(sidCookie).toBeDefined();
    expect(sidCookie).toMatch(/Max-Age=25\d{5}/); // ~2,592,000s (30 days), well above the 5-day stale value
  });

  it('does not reissue sid when the session is well within its TTL', async () => {
    const server = ctx.app.getHttpServer();
    const cookie = await registerWithPasskey(ctx, 'no-renewal@user.com');

    const res = await request(server).get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
