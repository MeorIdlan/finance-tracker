import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { Transaction, TransactionSchema } from '../database/schemas/transaction.schema';
import { BankAccount, BankAccountSchema } from '../database/schemas/bank-account.schema';
import { Commitment, CommitmentSchema } from '../database/schemas/commitment.schema';
import { Loan, LoanSchema } from '../database/schemas/loan.schema';
import { CreditCard, CreditCardSchema } from '../database/schemas/credit-card.schema';
import { AuditLog, AuditLogSchema } from '../database/schemas/audit-log.schema';
import { AuditLogService } from '../audit/audit.service';
import { BankAccountsService } from '../accounts/bank-accounts.service';
import { CommitmentsService } from '../commitments/commitments.service';
import { LoansService } from '../loans/loans.service';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { TransactionsService } from './transactions.service';

describe('TransactionsService actor tagging', () => {
  let mongod: MongoMemoryReplSet;
  let service: TransactionsService;
  let auditModel: import('mongoose').Model<AuditLog>;
  let userId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri('txn-actor-test')),
        MongooseModule.forFeature([
          { name: Transaction.name, schema: TransactionSchema },
          { name: BankAccount.name, schema: BankAccountSchema },
          { name: Commitment.name, schema: CommitmentSchema },
          { name: Loan.name, schema: LoanSchema },
          { name: CreditCard.name, schema: CreditCardSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
        ]),
      ],
      providers: [
        TransactionsService,
        AuditLogService,
        BankAccountsService,
        CommitmentsService,
        LoansService,
        CreditCardsService,
      ],
    }).compile();
    service = moduleRef.get(TransactionsService);
    auditModel = moduleRef.get(getModelToken(AuditLog.name));
    const bankModel = moduleRef.get(getModelToken(BankAccount.name));
    userId = new Types.ObjectId().toHexString();
    const account = await bankModel.create({
      userId: new Types.ObjectId(userId),
      name: 'Main',
      openingBalance: 100000,
      currentBalance: 100000,
      createdAt: new Date(),
    });
    bankAccountId = account._id.toHexString();
  });

  afterAll(async () => {
    await mongod.stop();
  });

  it('defaults the audit entry actor to "user" when not specified', async () => {
    await service.create(userId, {
      type: 'income',
      amount: 1000,
      date: new Date().toISOString(),
      sourceType: 'bankAccount',
      sourceId: bankAccountId,
    });
    const entry = await auditModel.findOne({ action: 'transaction.created' }).sort({
      _id: -1,
    });
    expect(entry?.actor).toBe('user');
  });

  it('tags the audit entry actor "agent" when passed explicitly', async () => {
    await service.create(
      userId,
      {
        type: 'income',
        amount: 2000,
        date: new Date().toISOString(),
        sourceType: 'bankAccount',
        sourceId: bankAccountId,
      },
      'agent',
    );
    const entry = await auditModel.findOne({ action: 'transaction.created' }).sort({
      _id: -1,
    });
    expect(entry?.actor).toBe('agent');
  });
});
