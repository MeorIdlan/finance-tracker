import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoanDto } from '@finance/shared';
import { Loan, LoanDocument } from '../database/schemas/loan.schema';
import { Transaction } from '../database/schemas/transaction.schema';
import { AuditLogService } from '../audit/audit.service';
import { CreateLoanDto, UpdateLoanDto } from './dto';

@Injectable()
export class LoansService {
  constructor(
    @InjectModel(Loan.name) private model: Model<Loan>,
    @InjectModel(Transaction.name) private txnModel: Model<Transaction>,
    private audit: AuditLogService,
  ) {}

  toDto(doc: LoanDocument): LoanDto {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      principal: doc.principal,
      interestRate: doc.interestRate,
      currentBalance: doc.currentBalance,
      startDate: doc.startDate.toISOString(),
    };
  }

  async mustOwn(userId: string, id: string): Promise<LoanDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async list(userId: string): Promise<LoanDto[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 });
    return docs.map((d) => this.toDto(d));
  }

  async create(userId: string, dto: CreateLoanDto): Promise<LoanDto> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      principal: dto.principal,
      interestRate: dto.interestRate,
      currentBalance: dto.currentBalance ?? dto.principal,
      startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
    });
    await this.audit.log({
      userId,
      action: 'loan.created',
      entityType: 'Loan',
      entityId: doc._id.toHexString(),
      metadata: { name: dto.name, principal: dto.principal },
    });
    return this.toDto(doc);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateLoanDto,
  ): Promise<LoanDto> {
    const doc = await this.mustOwn(userId, id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.interestRate !== undefined) doc.interestRate = dto.interestRate;
    await doc.save();
    await this.audit.log({
      userId,
      action: 'loan.updated',
      entityType: 'Loan',
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
        'Loan has payment transactions. Delete them first.',
      );
    }
    await doc.deleteOne();
    await this.audit.log({
      userId,
      action: 'loan.deleted',
      entityType: 'Loan',
      entityId: id,
      metadata: { name: doc.name },
    });
  }
}
