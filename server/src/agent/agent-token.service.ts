import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { AgentTokenStatusDto } from '@finance/shared';
import { ApiToken } from '../database/schemas/api-token.schema';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AgentTokenService {
  constructor(
    @InjectModel(ApiToken.name) private model: Model<ApiToken>,
  ) {}

  async rotate(userId: string): Promise<string> {
    const token = `ftk_${randomBytes(32).toString('base64url')}`;
    await this.model.updateOne(
      { userId: new Types.ObjectId(userId) },
      {
        tokenHash: hashToken(token),
        createdAt: new Date(),
        $unset: { lastUsedAt: '' },
      },
      { upsert: true },
    );
    return token;
  }

  async status(userId: string): Promise<AgentTokenStatusDto> {
    const doc = await this.model.findOne({ userId: new Types.ObjectId(userId) });
    if (!doc) return { hasToken: false, createdAt: null, lastUsedAt: null };
    return {
      hasToken: true,
      createdAt: doc.createdAt.toISOString(),
      lastUsedAt: doc.lastUsedAt?.toISOString() ?? null,
    };
  }

  async resolve(token: string): Promise<{ userId: string } | null> {
    const doc = await this.model.findOneAndUpdate(
      { tokenHash: hashToken(token) },
      { lastUsedAt: new Date() },
    );
    if (!doc) return null;
    return { userId: doc.userId.toHexString() };
  }
}
