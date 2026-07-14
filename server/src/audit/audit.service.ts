import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog } from '../database/schemas/audit-log.schema';

export interface AuditEntry {
  userId: string | Types.ObjectId;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name) private auditModel: Model<AuditLog>,
  ) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.auditModel.create({
      ...entry,
      userId: new Types.ObjectId(entry.userId),
    });
  }

  async list(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: AuditLog[]; total: number }> {
    const filter = { userId: new Types.ObjectId(userId) };
    const [items, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      this.auditModel.countDocuments(filter),
    ]);
    return { items, total };
  }
}
