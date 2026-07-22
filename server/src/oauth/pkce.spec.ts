import { createHash } from 'crypto';
import { verifyPkce } from './pkce';

describe('verifyPkce', () => {
  it('accepts a verifier whose S256 hash matches the challenge', () => {
    const verifier = 'a-random-code-verifier-string-1234567890';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it('rejects a verifier that does not match the challenge', () => {
    expect(verifyPkce('wrong-verifier', 'some-other-challenge')).toBe(false);
  });
});
