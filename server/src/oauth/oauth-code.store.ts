import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

export interface OauthCodeEntry {
  userId: string;
  token: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
}

@Injectable()
export class OauthCodeStore {
  private codes = new Map<string, OauthCodeEntry>();

  create(entry: OauthCodeEntry): string {
    this.sweep();
    const code = randomBytes(24).toString('base64url');
    this.codes.set(code, entry);
    return code;
  }

  consume(code: string): OauthCodeEntry | null {
    const entry = this.codes.get(code);
    this.codes.delete(code);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, entry] of this.codes) {
      if (entry.expiresAt < now) this.codes.delete(code);
    }
  }
}
