import request from 'supertest';
import { startMemoryMongo } from './utils/mongo';
import { createTestApp, TestCtx } from './utils/app';
import { seedAuthedUser } from './utils/auth';

function rpc(server: unknown, token: string, body: Record<string, unknown>) {
  return request(server as never)
    .post('/api/mcp')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .send(body);
}

// Each HTTP POST spins up a brand-new stateless MCP server (see mcp.controller.ts),
// so every request needs its own initialize handshake first, not just the first one.
async function initialize(server: unknown, token: string) {
  await rpc(server, token, {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
}

describe('MCP endpoint', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryMongo>>;
  let ctx: TestCtx;
  let cookie: string;
  let token: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongo = await startMemoryMongo();
    process.env.MONGODB_URI = mongo.uri;
    ctx = await createTestApp();
    ({ cookie } = await seedAuthedUser(ctx.app, 'mcp@user.com'));
    const server = ctx.app.getHttpServer();
    const rotateRes = await request(server)
      .post('/api/agent-token/rotate')
      .set('Cookie', cookie);
    token = rotateRes.body.token;
    const accountRes = await request(server)
      .post('/api/accounts/bank')
      .set('Cookie', cookie)
      .send({ name: 'Main', openingBalance: 500000 });
    bankAccountId = accountRes.body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
    await mongo.stop();
  });

  it('rejects requests without a valid bearer token', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);
  });

  it('lists the four v1 tools', async () => {
    const server = ctx.app.getHttpServer();
    await initialize(server, token);
    const res = await rpc(server, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = res.body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      'create_transaction',
      'get_summary',
      'list_accounts',
      'list_transactions',
    ]);
  });

  it('creates a transaction via tools/call and reflects it as an agent-tagged audit entry', async () => {
    const server = ctx.app.getHttpServer();
    await initialize(server, token);
    await rpc(server, token, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'create_transaction',
        arguments: {
          type: 'expense',
          amount: 2500,
          date: '2026-07-20T00:00:00.000Z',
          category: 'Food',
          sourceType: 'bankAccount',
          sourceId: bankAccountId,
        },
      },
    });

    const bank = await request(server)
      .get('/api/accounts/bank')
      .set('Cookie', cookie);
    expect(bank.body[0].currentBalance).toBe(500000 - 2500);

    const audit = await request(server)
      .get('/api/audit-log?page=1&pageSize=5')
      .set('Cookie', cookie);
    expect(audit.body.items[0].action).toBe('transaction.created');
  });

  it('stops accepting the old token after rotate', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).post('/api/agent-token/rotate').set('Cookie', cookie);
    await rpc(server, token, { jsonrpc: '2.0', id: 4, method: 'tools/list' }).expect(401);
  });
});
