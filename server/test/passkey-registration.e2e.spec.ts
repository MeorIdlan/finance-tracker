import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { Session } from '../src/database/schemas/session.schema';
import { Credential } from '../src/database/schemas/credential.schema';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({
    challenge: 'test-challenge',
    rp: { name: 'Finance Tracker', id: 'localhost' },
  })),
  verifyRegistrationResponse: jest.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'cred-abc',
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

describe('passkey registration ceremony', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    // Register through the real flow to obtain a pending session cookie.
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'PK User', email: 'pk@user.com' });
    const code = ctx.sentCodes.get('pk@user.com')!;
    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ email: 'pk@user.com', code, purpose: 'register' });
    cookie = res.headers['set-cookie'][0].split(';')[0];
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('rejects the ceremony without a session', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/passkey/options')
      .expect(401);
  });

  it('returns creation options for a pending session', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/passkey/options')
      .set('Cookie', cookie)
      .expect(201);
    expect(res.body.challenge).toBe('test-challenge');
  });

  it('verifies, stores the credential, and upgrades the session', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/passkey/verify')
      .set('Cookie', cookie)
      .send({ response: { id: 'cred-abc' }, deviceLabel: 'Test Device' })
      .expect(201);
    expect(res.body.deviceLabel).toBe('Test Device');

    const credModel: Model<Credential> = ctx.app.get(
      getModelToken(Credential.name),
    );
    const cred = await credModel.findOne({ credentialId: 'cred-abc' });
    expect(cred).not.toBeNull();

    const sessionModel: Model<Session> = ctx.app.get(
      getModelToken(Session.name),
    );
    const session = await sessionModel.findOne().sort({ createdAt: -1 });
    expect(session!.scope).toBe('full');
  });
});
