import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BankAccountDto } from '@finance/shared';
import {
  BankAccount,
  BankAccountDocument,
} from '../database/schemas/bank-account.schema';
import { Transaction } from '../database/schemas/transaction.schema';
import { AuditLogService } from '../audit/audit.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto';

@Injectable()
export class BankAccountsService {
  constructor(
    @InjectModel(BankAccount.name) private model: Model<BankAccount>,
    @InjectModel(Transaction.name) private txnModel: Model<Transaction>,
    private audit: AuditLogService,
  ) {}

  toDto(doc: BankAccountDocument): BankAccountDto {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      openingBalance: doc.openingBalance,
      currentBalance: doc.currentBalance,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async mustOwn(userId: string, id: string): Promise<BankAccountDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async list(userId: string): Promise<BankAccountDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 });
    return docs.map((d) => this.toDto(d));
  }

  async create(
    userId: string,
    dto: CreateBankAccountDto,
  ): Promise<BankAccountDto> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      openingBalance: dto.openingBalance,
      currentBalance: dto.openingBalance,
    });
    await this.audit.log({
      userId,
      action: 'bankAccount.created',
      entityType: 'BankAccount',
      entityId: doc._id.toHexString(),
      metadata: { name: dto.name, openingBalance: dto.openingBalance },
    });
    return this.toDto(doc);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateBankAccountDto,
  ): Promise<BankAccountDto> {
    const doc = await this.mustOwn(userId, id);
    if (dto.name !== undefined) doc.name = dto.name;
    await doc.save();
    await this.audit.log({
      userId,
      action: 'bankAccount.updated',
      entityType: 'BankAccount',
      entityId: id,
      metadata: { name: doc.name },
    });
    return this.toDto(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.mustOwn(userId, id);
    const inUse = await this.txnModel.exists({
      userId: new Types.ObjectId(userId),
      $or: [{ sourceId: doc._id }, { toAccountId: doc._id }],
    });
    if (inUse) {
      throw new ConflictException(
        'Account has transactions. Delete them first.',
      );
    }
    await doc.deleteOne();
    await this.audit.log({
      userId,
      action: 'bankAccount.deleted',
      entityType: 'BankAccount',
      entityId: id,
      metadata: { name: doc.name },
    });
  }

  async recompute(
    userId: string,
    id: string,
  ): Promise<{ currentBalance: number; drift: number }> {
    const acc = await this.mustOwn(userId, id);
    const txns = await this.txnModel.find({
      userId: new Types.ObjectId(userId),
      $or: [{ sourceId: acc._id }, { toAccountId: acc._id }],
    });
    let balance = acc.openingBalance;
    for (const t of txns) {
      if (t.toAccountId?.equals(acc._id) && t.type === 'transfer') {
        balance += t.amount;
      }
      if (t.sourceId.equals(acc._id)) {
        balance += t.type === 'income' ? t.amount : -t.amount;
      }
    }
    const drift = balance - acc.currentBalance;
    acc.currentBalance = balance;
    await acc.save();
    await this.audit.log({
      userId,
      action: 'bankAccount.recomputed',
      entityType: 'BankAccount',
      entityId: id,
      metadata: { drift },
    });
    return { currentBalance: balance, drift };
  }
}
