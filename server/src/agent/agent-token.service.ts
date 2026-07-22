import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { AgentTokenDto } from '@finance/shared';
import { ApiToken, ApiTokenSource } from '../database/schemas/api-token.schema';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AgentTokenService implements OnModuleInit {
  constructor(
    @InjectModel(ApiToken.name) private model: Model<ApiToken>,
  ) {}

  // Drops the stale unique-per-user index from before the multi-token rework — autoIndex only adds, never removes.
  async onModuleInit(): Promise<void> {
    await this.model.syncIndexes();
  }

  async create(
    userId: string,
    label: string,
    source: ApiTokenSource,
  ): Promise<{ id: string; token: string }> {
    const token = `ftk_${randomBytes(32).toString('base64url')}`;
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      label,
      tokenHash: hashToken(token),
      createdAt: new Date(),
      source,
    });
    return { id: doc._id.toHexString(), token };
  }

  async list(userId: string): Promise<AgentTokenDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 });
    return docs.map((doc) => ({
      id: doc._id.toHexString(),
      label: doc.label,
      createdAt: doc.createdAt.toISOString(),
      lastUsedAt: doc.lastUsedAt?.toISOString() ?? null,
      source: doc.source,
    }));
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    const res = await this.model.deleteOne({
      _id: new Types.ObjectId(tokenId),
      userId: new Types.ObjectId(userId),
    });
    if (res.deletedCount === 0) throw new NotFoundException();
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
