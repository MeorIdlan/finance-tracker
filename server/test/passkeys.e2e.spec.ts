import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { Credential } from '../src/database/schemas/credential.schema';
import { User } from '../src/database/schemas/user.schema';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({
    challenge: 'test-challenge',
  })),
  verifyRegistrationResponse: jest.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'cred-mgmt',
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

describe('passkey management and audit log', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    const server = ctx.app.getHttpServer();
    await request(server).post('/api/auth/register').send({ email: 'm@u.com' });
    const code = ctx.sentCodes.get('m@u.com')!;
    const otpRes = await request(server)
      .post('/api/auth/verify-otp')
      .send({ email: 'm@u.com', code, purpose: 'register' });
    cookie = otpRes.headers['set-cookie'][0].split(';')[0];
    await request(server).post('/api/auth/passkey/options').set('Cookie', cookie);
    await request(server)
      .post('/api/auth/passkey/verify')
      .set('Cookie', cookie)
      .send({ response: { id: 'cred-mgmt' }, deviceLabel: 'Primary' });
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('lists passkeys', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/passkeys')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].deviceLabel).toBe('Primary');
  });

  it('refuses to remove the last passkey', async () => {
    const list = await request(ctx.app.getHttpServer())
      .get('/api/passkeys')
      .set('Cookie', cookie);
    await request(ctx.app.getHttpServer())
      .delete(`/api/passkeys/${list.body[0].id}`)
      .set('Cookie', cookie)
      .expect(400);
  });

  it('removes a non-last passkey and audits it', async () => {
    const credModel: Model<Credential> = ctx.app.get(
      getModelToken(Credential.name),
    );
    const userModel: Model<User> = ctx.app.get(getModelToken(User.name));
    const user = await userModel.findOne({ email: 'm@u.com' });
    const extra = await credModel.create({
      userId: user!._id,
      credentialId: 'cred-extra',
      publicKey: Buffer.from([9]),
      counter: 0,
      deviceLabel: 'Old Phone',
    });

    await request(ctx.app.getHttpServer())
      .delete(`/api/passkeys/${extra._id.toHexString()}`)
      .set('Cookie', cookie)
      .expect(200);

    const audit = await request(ctx.app.getHttpServer())
      .get('/api/audit-log?page=1&pageSize=10')
      .set('Cookie', cookie)
      .expect(200);
    expect(audit.body.items[0].action).toBe('passkey.removed');
    expect(audit.body.total).toBeGreaterThanOrEqual(3);
  });

  it('404s when deleting another users passkey id', async () => {
    await request(ctx.app.getHttpServer())
      .delete(`/api/passkeys/${new Types.ObjectId().toHexString()}`)
      .set('Cookie', cookie)
      .expect(404);
  });
});
