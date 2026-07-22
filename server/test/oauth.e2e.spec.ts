import request from 'supertest';
import { createHash, randomBytes } from 'crypto';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

describe('OAuth shim', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'oauth@user.com'));
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('serves discovery metadata unprefixed, pointing at the /api endpoints', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/.well-known/oauth-authorization-server')
      .expect(200);
    expect(res.body.authorization_endpoint).toMatch(/\/api\/oauth\/authorize$/);
    expect(res.body.token_endpoint).toMatch(/\/api\/oauth\/token$/);
    expect(res.body.registration_endpoint).toMatch(/\/api\/oauth\/register$/);
  });

  it('register returns a client_id without requiring auth', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/oauth/register')
      .send({ redirect_uris: ['http://127.0.0.1:54321/callback'] })
      .expect(201);
    expect(typeof res.body.client_id).toBe('string');
  });

  it('register echoes back redirect_uris as required by RFC 7591', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/oauth/register')
      .send({ redirect_uris: ['http://127.0.0.1:54321/callback'], client_name: 'Claude' })
      .expect(201);
    expect(res.body.redirect_uris).toEqual(['http://127.0.0.1:54321/callback']);
    expect(res.body.grant_types).toEqual(['authorization_code']);
    expect(res.body.response_types).toEqual(['code']);
  });

  it('register rejects a request missing redirect_uris', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/oauth/register')
      .send({})
      .expect(400);
  });

  it('authorize redirects to the frontend consent page for a loopback redirect_uri', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/oauth/authorize')
      .query({
        client_id: 'abc',
        redirect_uri: 'http://127.0.0.1:54321/callback',
        state: 'xyz',
        code_challenge: 'chal',
        code_challenge_method: 'S256',
        response_type: 'code',
      })
      .expect(302);
    expect(res.headers.location).toContain('/oauth-consent?');
    expect(res.headers.location).toContain('redirect_uri=');
  });

  it('authorize redirects to the frontend consent page for the Claude hosted callback redirect_uri', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/oauth/authorize')
      .query({
        client_id: 'abc',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        state: 'xyz',
        code_challenge: 'chal',
        code_challenge_method: 'S256',
        response_type: 'code',
      })
      .expect(302);
    expect(res.headers.location).toContain('/oauth-consent?');
  });

  it('authorize rejects a non-loopback redirect_uri', async () => {
    await request(ctx.app.getHttpServer())
      .get('/api/oauth/authorize')
      .query({ redirect_uri: 'https://evil.example.com/callback' })
      .expect(400);
  });

  it('approve requires an authenticated session', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/oauth/authorize/approve')
      .send({
        redirectUri: 'http://127.0.0.1:54321/callback',
        codeChallenge: 'chal',
        codeChallengeMethod: 'S256',
      })
      .expect(401);
  });

  it('completes the full authorize -> approve -> token exchange, and the resulting access_token works against /api/mcp', async () => {
    const server = ctx.app.getHttpServer();
    const { verifier, challenge } = pkcePair();
    const redirectUri = 'http://127.0.0.1:54321/callback';

    const approveRes = await request(server)
      .post('/api/oauth/authorize/approve')
      .set('Cookie', cookie)
      .send({
        redirectUri,
        state: 'xyz',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      })
      .expect(201);

    const redirectUrl = new URL(approveRes.body.redirectUrl);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(redirectUri);
    expect(redirectUrl.searchParams.get('state')).toBe('xyz');
    const code = redirectUrl.searchParams.get('code');
    expect(code).toBeTruthy();

    const tokenRes = await request(server)
      .post('/api/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      })
      .expect(201);
    expect(tokenRes.body.token_type).toBe('Bearer');
    const accessToken = tokenRes.body.access_token as string;
    expect(accessToken).toMatch(/^ftk_/);

    await request(server)
      .post('/api/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'claude-desktop', version: '1.0.0' },
        },
      })
      .expect(200);

    const listRes = await request(server)
      .get('/api/agent-token/list')
      .set('Cookie', cookie);
    expect(
      listRes.body.some(
        (t: { label: string; source: string }) =>
          t.label === 'Claude Desktop (OAuth)' && t.source === 'oauth',
      ),
    ).toBe(true);
  });

  it('rejects reusing the same authorization code', async () => {
    const server = ctx.app.getHttpServer();
    const { verifier, challenge } = pkcePair();
    const redirectUri = 'http://127.0.0.1:1/cb';

    const approveRes = await request(server)
      .post('/api/oauth/authorize/approve')
      .set('Cookie', cookie)
      .send({ redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256' });
    const code = new URL(approveRes.body.redirectUrl).searchParams.get('code');

    const body = { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri };
    await request(server).post('/api/oauth/token').type('form').send(body).expect(201);
    const second = await request(server).post('/api/oauth/token').type('form').send(body).expect(400);
    expect(second.body.error).toBe('invalid_grant');
  });

  it('rejects a mismatched PKCE verifier', async () => {
    const server = ctx.app.getHttpServer();
    const { challenge } = pkcePair();
    const redirectUri = 'http://127.0.0.1:2/cb';

    const approveRes = await request(server)
      .post('/api/oauth/authorize/approve')
      .set('Cookie', cookie)
      .send({ redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256' });
    const code = new URL(approveRes.body.redirectUrl).searchParams.get('code');

    const res = await request(server)
      .post('/api/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'totally-wrong-verifier',
        redirect_uri: redirectUri,
      })
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('rejects a redirect_uri that does not match the one used at approve time', async () => {
    const server = ctx.app.getHttpServer();
    const { verifier, challenge } = pkcePair();
    const approveRedirectUri = 'http://127.0.0.1:3/cb';
    const tokenRedirectUri = 'http://127.0.0.1:4/cb';

    const approveRes = await request(server)
      .post('/api/oauth/authorize/approve')
      .set('Cookie', cookie)
      .send({ redirectUri: approveRedirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256' });
    const code = new URL(approveRes.body.redirectUrl).searchParams.get('code');

    const res = await request(server)
      .post('/api/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: tokenRedirectUri,
      })
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
  });
});
