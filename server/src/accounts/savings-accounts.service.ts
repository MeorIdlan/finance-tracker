import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SavingsAccountDto, ValueSnapshotDto } from '@finance/shared';
import {
  SavingsAccount,
  SavingsAccountDocument,
} from '../database/schemas/savings-account.schema';
import { ValueSnapshot } from '../database/schemas/value-snapshot.schema';
import { AuditLogService } from '../audit/audit.service';
import {
  CreateSavingsAccountDto,
  CreateSnapshotDto,
  UpdateSavingsAccountDto,
} from './dto';

@Injectable()
export class SavingsAccountsService {
  constructor(
    @InjectModel(SavingsAccount.name) private model: Model<SavingsAccount>,
    @InjectModel(ValueSnapshot.name)
    private snapshotModel: Model<ValueSnapshot>,
    private audit: AuditLogService,
  ) {}

  private async mustOwn(
    userId: string,
    id: string,
  ): Promise<SavingsAccountDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  private async toDto(doc: SavingsAccountDocument): Promise<SavingsAccountDto> {
    const latest = await this.snapshotModel
      .findOne({ accountId: doc._id })
      .sort({ date: -1 });
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      type: doc.type,
      latestValue: latest?.value ?? null,
      latestValueDate: latest?.date.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async list(userId: string): Promise<SavingsAccountDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 });
    return Promise.all(docs.map((d) => this.toDto(d)));
  }

  async create(
    userId: string,
    dto: CreateSavingsAccountDto,
  ): Promise<SavingsAccountDto> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      type: dto.type,
    });
    await this.audit.log({
      userId,
      action: 'savingsAccount.created',
      entityType: 'SavingsAccount',
      entityId: doc._id.toHexString(),
      metadata: { name: dto.name, type: dto.type },
    });
    return this.toDto(doc);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateSavingsAccountDto,
  ): Promise<SavingsAccountDto> {
    const doc = await this.mustOwn(userId, id);
    if (dto.name !== undefined) doc.name = dto.name;
    await doc.save();
    await this.audit.log({
      userId,
      action: 'savingsAccount.updated',
      entityType: 'SavingsAccount',
      entityId: id,
      metadata: { name: doc.name },
    });
    return this.toDto(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.mustOwn(userId, id);
    await this.snapshotModel.deleteMany({ accountId: doc._id });
    await doc.deleteOne();
    await this.audit.log({
      userId,
      action: 'savingsAccount.deleted',
      entityType: 'SavingsAccount',
      entityId: id,
      metadata: { name: doc.name },
    });
  }

  async listSnapshots(userId: string, id: string): Promise<ValueSnapshotDto[]> {
    const doc = await this.mustOwn(userId, id);
    const snaps = await this.snapshotModel
      .find({ accountId: doc._id })
      .sort({ date: -1 });
    return snaps.map((s) => ({
      id: s._id.toHexString(),
      date: s.date.toISOString(),
      value: s.value,
    }));
  }

  async addSnapshot(
    userId: string,
    id: string,
    dto: CreateSnapshotDto,
  ): Promise<ValueSnapshotDto> {
    const doc = await this.mustOwn(userId, id);
    const snap = await this.snapshotModel.create({
      accountId: doc._id,
      date: new Date(dto.date),
      value: dto.value,
    });
    await this.audit.log({
      userId,
      action: 'snapshot.added',
      entityType: 'SavingsAccount',
      entityId: id,
      metadata: { date: dto.date, value: dto.value },
    });
    return {
      id: snap._id.toHexString(),
      date: snap.date.toISOString(),
      value: snap.value,
    };
  }
}
