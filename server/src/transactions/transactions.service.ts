import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Paginated, TransactionDto } from '@finance/shared';
import {
  Transaction,
  TransactionDocument,
} from '../database/schemas/transaction.schema';
import { BankAccount } from '../database/schemas/bank-account.schema';
import { Commitment } from '../database/schemas/commitment.schema';
import { Loan } from '../database/schemas/loan.schema';
import { CreditCard } from '../database/schemas/credit-card.schema';
import { shiftDueDate } from '../common/dates';
import { AuditLogService } from '../audit/audit.service';
import { BankAccountsService } from '../accounts/bank-accounts.service';
import { CommitmentsService } from '../commitments/commitments.service';
import { LoansService } from '../loans/loans.service';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import {
  CreateTransactionDto,
  ListTransactionsQuery,
  UpdateTransactionDto,
} from './dto';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(Transaction.name) private txnModel: Model<Transaction>,
    @InjectModel(BankAccount.name) private bankModel: Model<BankAccount>,
    @InjectModel(Commitment.name) private commitmentModel: Model<Commitment>,
    @InjectModel(Loan.name) private loanModel: Model<Loan>,
    @InjectModel(CreditCard.name) private cardModel: Model<CreditCard>,
    private bankAccounts: BankAccountsService,
    private commitments: CommitmentsService,
    private loans: LoansService,
    private cards: CreditCardsService,
    private audit: AuditLogService,
  ) {}

  toDto(doc: TransactionDocument): TransactionDto {
    return {
      id: doc._id.toHexString(),
      type: doc.type,
      amount: doc.amount,
      date: doc.date.toISOString(),
      category: doc.category,
      accountId: doc.accountId?.toHexString(),
      toAccountId: doc.toAccountId?.toHexString(),
      linkedEntityId: doc.linkedEntityId?.toHexString(),
      note: doc.note,
    };
  }

  private requireLink(dto: CreateTransactionDto): string {
    if (!dto.linkedEntityId) {
      throw new BadRequestException('linkedEntityId is required for this type.');
    }
    return dto.linkedEntityId;
  }

  private async validateRefs(
    userId: string,
    dto: CreateTransactionDto,
  ): Promise<void> {
    if (dto.type !== 'cardCharge') {
      if (!dto.accountId) {
        throw new BadRequestException('accountId is required for this type.');
      }
      await this.bankAccounts.mustOwn(userId, dto.accountId);
    }
    if (dto.type === 'expense' && !dto.category) {
      throw new BadRequestException('category is required for expenses.');
    }
    if (dto.type === 'transfer') {
      if (!dto.toAccountId) {
        throw new BadRequestException('toAccountId is required for transfers.');
      }
      if (dto.toAccountId === dto.accountId) {
        throw new BadRequestException('Cannot transfer to the same account.');
      }
      await this.bankAccounts.mustOwn(userId, dto.toAccountId);
    }
    if (dto.type === 'commitmentPayment') {
      await this.commitments.mustOwn(userId, this.requireLink(dto));
    }
    if (dto.type === 'loanPayment') {
      await this.loans.mustOwn(userId, this.requireLink(dto));
    }
    if (dto.type === 'cardPayment' || dto.type === 'cardCharge') {
      await this.cards.mustOwn(userId, this.requireLink(dto));
    }
  }

  private async applyEffect(
    txn: TransactionDocument,
    sign: 1 | -1,
    session: ClientSession,
  ): Promise<void> {
    const amt = sign * txn.amount;
    const debitBank = () =>
      this.bankModel.updateOne(
        { _id: txn.accountId },
        { $inc: { currentBalance: -amt } },
        { session },
      );
    switch (txn.type) {
      case 'income':
        await this.bankModel.updateOne(
          { _id: txn.accountId },
          { $inc: { currentBalance: amt } },
          { session },
        );
        break;
      case 'expense':
        await debitBank();
        break;
      case 'commitmentPayment': {
        await debitBank();
        const c = await this.commitmentModel
          .findById(txn.linkedEntityId)
          .session(session);
        if (c) {
          c.nextDueDate = shiftDueDate(c.nextDueDate, c.dueDayOfMonth, sign);
          await c.save({ session });
        }
        break;
      }
      case 'loanPayment':
        await debitBank();
        await this.loanModel.updateOne(
          { _id: txn.linkedEntityId },
          { $inc: { currentBalance: -amt } },
          { session },
        );
        break;
      case 'cardPayment':
        await debitBank();
        await this.cardModel.updateOne(
          { _id: txn.linkedEntityId },
          { $inc: { currentBalance: -amt, statementBalance: -amt } },
          { session },
        );
        break;
      case 'cardCharge':
        await this.cardModel.updateOne(
          { _id: txn.linkedEntityId },
          { $inc: { currentBalance: amt } },
          { session },
        );
        break;
      case 'transfer':
        await debitBank();
        await this.bankModel.updateOne(
          { _id: txn.toAccountId },
          { $inc: { currentBalance: amt } },
          { session },
        );
        break;
    }
  }

  async create(
    userId: string,
    dto: CreateTransactionDto,
  ): Promise<TransactionDto> {
    await this.validateRefs(userId, dto);
    let doc!: TransactionDocument;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        [doc] = await this.txnModel.create(
          [
            {
              userId: new Types.ObjectId(userId),
              type: dto.type,
              amount: dto.amount,
              date: new Date(dto.date),
              category: dto.category,
              accountId: dto.accountId
                ? new Types.ObjectId(dto.accountId)
                : undefined,
              toAccountId: dto.toAccountId
                ? new Types.ObjectId(dto.toAccountId)
                : undefined,
              linkedEntityId: dto.linkedEntityId
                ? new Types.ObjectId(dto.linkedEntityId)
                : undefined,
              note: dto.note,
            },
          ],
          { session },
        );
        await this.applyEffect(doc, 1, session);
      });
    } finally {
      await session.endSession();
    }
    await this.audit.log({
      userId,
      action: 'transaction.created',
      entityType: 'Transaction',
      entityId: doc._id.toHexString(),
      metadata: { type: dto.type, amount: dto.amount },
    });
    return this.toDto(doc);
  }

  async mustOwnTxn(userId: string, id: string): Promise<TransactionDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.txnModel.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateTransactionDto,
  ): Promise<TransactionDto> {
    const doc = await this.mustOwnTxn(userId, id);
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.applyEffect(doc, -1, session);
        if (dto.amount !== undefined) doc.amount = dto.amount;
        if (dto.date !== undefined) doc.date = new Date(dto.date);
        if (dto.category !== undefined) doc.category = dto.category;
        if (dto.note !== undefined) doc.note = dto.note;
        await doc.save({ session });
        await this.applyEffect(doc, 1, session);
      });
    } finally {
      await session.endSession();
    }
    await this.audit.log({
      userId,
      action: 'transaction.updated',
      entityType: 'Transaction',
      entityId: id,
      metadata: { amount: doc.amount },
    });
    return this.toDto(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.mustOwnTxn(userId, id);
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.applyEffect(doc, -1, session);
        await doc.deleteOne({ session });
      });
    } finally {
      await session.endSession();
    }
    await this.audit.log({
      userId,
      action: 'transaction.deleted',
      entityType: 'Transaction',
      entityId: id,
      metadata: { type: doc.type, amount: doc.amount },
    });
  }

  async list(
    userId: string,
    q: ListTransactionsQuery,
  ): Promise<Paginated<TransactionDto>> {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (q.type) filter.type = q.type;
    if (q.category) filter.category = q.category;
    if (q.accountId) {
      const oid = new Types.ObjectId(q.accountId);
      filter.$or = [{ accountId: oid }, { toAccountId: oid }];
    }
    if (q.from || q.to) {
      filter.date = {
        ...(q.from ? { $gte: new Date(q.from) } : {}),
        ...(q.to ? { $lte: new Date(q.to) } : {}),
      };
    }
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10) || 20));
    const [items, total] = await Promise.all([
      this.txnModel
        .find(filter)
        .sort({ date: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      this.txnModel.countDocuments(filter),
    ]);
    return { items: items.map((d) => this.toDto(d)), total };
  }
}
