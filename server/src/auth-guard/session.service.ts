import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { Session, SessionScope } from '../database/schemas/session.schema';
import { User } from '../database/schemas/user.schema';

export const PENDING_TTL_MS = 15 * 60 * 1000;

export interface RequestUser {
  sessionId: string;
  userId: string;
  scope: SessionScope;
  email: string;
  renewed: boolean;
}

/**
 * The shape actually attached to `req.user` — AuthGuard strips `renewed`
 * before assignment, so controllers/`@CurrentUser()` never see it.
 */
export type AuthenticatedUser = Omit<RequestUser, 'renewed'>;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  private fullTtlMs: number;

  constructor(
    private config: ConfigService,
    @InjectModel(Session.name) private sessionModel: Model<Session>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {
    const days = parseInt(this.config.get('SESSION_TTL_DAYS', '30'), 10);
    this.fullTtlMs = days * 24 * 60 * 60 * 1000;
  }

  async create(userId: Types.ObjectId, scope: SessionScope): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const ttl = scope === 'full' ? this.fullTtlMs : PENDING_TTL_MS;
    await this.sessionModel.create({
      tokenHash: hashToken(token),
      userId,
      scope,
      expiresAt: new Date(Date.now() + ttl),
    });
    return token;
  }

  async validate(token: string): Promise<RequestUser | null> {
    const session = await this.sessionModel.findOne({
      tokenHash: hashToken(token),
      expiresAt: { $gt: new Date() },
    });
    if (!session) return null;
    const user = await this.userModel.findById(session.userId);
    if (!user) return null;

    let renewed = false;
    if (session.scope === 'full') {
      const remainingMs = session.expiresAt.getTime() - Date.now();
      if (remainingMs < this.fullTtlMs / 2) {
        await this.sessionModel.updateOne(
          { _id: session._id },
          { expiresAt: new Date(Date.now() + this.fullTtlMs) },
        );
        renewed = true;
      }
    }

    return {
      sessionId: session._id.toHexString(),
      userId: session.userId.toHexString(),
      scope: session.scope,
      email: user.email,
      renewed,
    };
  }

  async upgrade(sessionId: string): Promise<void> {
    await this.sessionModel.updateOne(
      { _id: new Types.ObjectId(sessionId) },
      { scope: 'full', expiresAt: new Date(Date.now() + this.fullTtlMs) },
    );
  }

  async destroy(token: string): Promise<void> {
    await this.sessionModel.deleteOne({ tokenHash: hashToken(token) });
  }
}
