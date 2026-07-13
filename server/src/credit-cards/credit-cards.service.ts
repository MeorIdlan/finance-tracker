import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreditCardDto } from '@finance/shared';
import {
  CreditCard,
  CreditCardDocument,
} from '../database/schemas/credit-card.schema';
import { Transaction } from '../database/schemas/transaction.schema';
import { dueDateInMonth } from '../common/dates';
import { AuditLogService } from '../audit/audit.service';
import { CreateCreditCardDto, UpdateCreditCardDto } from './dto';

function latestStatementDate(statementDay: number, now = new Date()): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonth = dueDateInMonth(y, m, statementDay);
  return thisMonth <= now ? thisMonth : dueDateInMonth(y, m - 1, statementDay);
}

@Injectable()
export class CreditCardsService {
  constructor(
    @InjectModel(CreditCard.name) private model: Model<CreditCard>,
    @InjectModel(Transaction.name) private txnModel: Model<Transaction>,
    private audit: AuditLogService,
  ) {}

  toDto(doc: CreditCardDocument): CreditCardDto {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      creditLimit: doc.creditLimit,
      statementBalance: doc.statementBalance,
      currentBalance: doc.currentBalance,
      statementDay: doc.statementDay,
      dueDay: doc.dueDay,
    };
  }

  private async ensureStatementCurrent(
    doc: CreditCardDocument,
  ): Promise<CreditCardDocument> {
    const latest = latestStatementDate(doc.statementDay);
    if (doc.lastStatementAt < latest) {
      doc.statementBalance = doc.currentBalance;
      doc.lastStatementAt = latest;
      await doc.save();
    }
    return doc;
  }

  async mustOwn(userId: string, id: string): Promise<CreditCardDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async list(userId: string): Promise<CreditCardDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 });
    const rolled = await Promise.all(
      docs.map((d) => this.ensureStatementCurrent(d)),
    );
    return rolled.map((d) => this.toDto(d));
  }

  async create(
    userId: string,
    dto: CreateCreditCardDto,
  ): Promise<CreditCardDto> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      creditLimit: dto.creditLimit,
      statementDay: dto.statementDay,
      dueDay: dto.dueDay,
      currentBalance: dto.currentBalance ?? 0,
      statementBalance: 0,
      lastStatementAt: new Date(),
    });
    await this.audit.log({
      userId,
      action: 'creditCard.created',
      entityType: 'CreditCard',
      entityId: doc._id.toHexString(),
      metadata: { name: dto.name, creditLimit: dto.creditLimit },
    });
    return this.toDto(doc);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCreditCardDto,
  ): Promise<CreditCardDto> {
    const doc = await this.mustOwn(userId, id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.creditLimit !== undefined) doc.creditLimit = dto.creditLimit;
    if (dto.statementDay !== undefined) doc.statementDay = dto.statementDay;
    if (dto.dueDay !== undefined) doc.dueDay = dto.dueDay;
    await doc.save();
    await this.audit.log({
      userId,
      action: 'creditCard.updated',
      entityType: 'CreditCard',
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
        'Card has transactions. Delete them first.',
      );
    }
    await doc.deleteOne();
    await this.audit.log({
      userId,
      action: 'creditCard.deleted',
      entityType: 'CreditCard',
      entityId: id,
      metadata: { name: doc.name },
    });
  }
}
