import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CommitmentDto } from '@finance/shared';
import {
  Commitment,
  CommitmentDocument,
} from '../database/schemas/commitment.schema';
import { Transaction } from '../database/schemas/transaction.schema';
import { commitmentStatus, nextDueDateFrom } from '../common/dates';
import { AuditLogService } from '../audit/audit.service';
import { CreateCommitmentDto, UpdateCommitmentDto } from './dto';

@Injectable()
export class CommitmentsService {
  constructor(
    @InjectModel(Commitment.name) private model: Model<Commitment>,
    @InjectModel(Transaction.name) private txnModel: Model<Transaction>,
    private audit: AuditLogService,
  ) {}

  toDto(doc: CommitmentDocument): CommitmentDto {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      amount: doc.amount,
      dueDayOfMonth: doc.dueDayOfMonth,
      nextDueDate: doc.nextDueDate.toISOString(),
      active: doc.active,
      status: commitmentStatus(doc.nextDueDate),
    };
  }

  async mustOwn(userId: string, id: string): Promise<CommitmentDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async list(userId: string): Promise<CommitmentDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ nextDueDate: 1 });
    return docs.map((d) => this.toDto(d));
  }

  async create(
    userId: string,
    dto: CreateCommitmentDto,
  ): Promise<CommitmentDto> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      amount: dto.amount,
      dueDayOfMonth: dto.dueDayOfMonth,
      nextDueDate: nextDueDateFrom(dto.dueDayOfMonth),
      active: true,
    });
    await this.audit.log({
      userId,
      action: 'commitment.created',
      entityType: 'Commitment',
      entityId: doc._id.toHexString(),
      metadata: { name: dto.name, amount: dto.amount },
    });
    return this.toDto(doc);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCommitmentDto,
  ): Promise<CommitmentDto> {
    const doc = await this.mustOwn(userId, id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.amount !== undefined) doc.amount = dto.amount;
    if (dto.active !== undefined) doc.active = dto.active;
    if (
      dto.dueDayOfMonth !== undefined &&
      dto.dueDayOfMonth !== doc.dueDayOfMonth
    ) {
      doc.dueDayOfMonth = dto.dueDayOfMonth;
      doc.nextDueDate = nextDueDateFrom(dto.dueDayOfMonth);
    }
    await doc.save();
    await this.audit.log({
      userId,
      action: 'commitment.updated',
      entityType: 'Commitment',
      entityId: id,
      metadata: { name: doc.name },
    });
    return this.toDto(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.mustOwn(userId, id);
    const inUse = await this.txnModel.exists({ linkedEntityId: doc._id });
    if (inUse) {
      throw new ConflictException(
        'Commitment has payment transactions. Delete them first.',
      );
    }
    await doc.deleteOne();
    await this.audit.log({
      userId,
      action: 'commitment.deleted',
      entityType: 'Commitment',
      entityId: id,
      metadata: { name: doc.name },
    });
  }
}
