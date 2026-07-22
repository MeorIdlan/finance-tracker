import { OauthCodeStore } from './oauth-code.store';

describe('OauthCodeStore', () => {
  it('consume returns the entry and deletes it (single use)', () => {
    const store = new OauthCodeStore();
    const code = store.create({
      userId: 'u1',
      token: 'ftk_x',
      redirectUri: 'http://127.0.0.1:1234/cb',
      codeChallenge: 'chal',
      expiresAt: Date.now() + 60_000,
    });

    expect(store.consume(code)).toMatchObject({ userId: 'u1', token: 'ftk_x' });
    expect(store.consume(code)).toBeNull();
  });

  it('consume returns null for an unknown code', () => {
    const store = new OauthCodeStore();
    expect(store.consume('does-not-exist')).toBeNull();
  });

  it('consume returns null for an expired code', () => {
    const store = new OauthCodeStore();
    const code = store.create({
      userId: 'u1',
      token: 'ftk_x',
      redirectUri: 'http://127.0.0.1:1234/cb',
      codeChallenge: 'chal',
      expiresAt: Date.now() - 1,
    });

    expect(store.consume(code)).toBeNull();
  });

  it('two independently created codes do not collide', () => {
    const store = new OauthCodeStore();
    const codeA = store.create({
      userId: 'a',
      token: 'ftk_a',
      redirectUri: 'http://127.0.0.1:1/cb',
      codeChallenge: 'ca',
      expiresAt: Date.now() + 60_000,
    });
    const codeB = store.create({
      userId: 'b',
      token: 'ftk_b',
      redirectUri: 'http://127.0.0.1:2/cb',
      codeChallenge: 'cb',
      expiresAt: Date.now() + 60_000,
    });

    expect(codeA).not.toBe(codeB);
    expect(store.consume(codeA)).toMatchObject({ userId: 'a' });
    expect(store.consume(codeB)).toMatchObject({ userId: 'b' });
  });
});
