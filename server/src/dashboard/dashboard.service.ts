import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BalanceSlice,
  CategoryTotal,
  DashboardSummary,
  EXPENSE_CATEGORIES,
  MonthPoint,
  TransactionDto,
  UpcomingBill,
} from '@finance/shared';
import { BankAccount } from '../database/schemas/bank-account.schema';
import { SavingsAccount } from '../database/schemas/savings-account.schema';
import { ValueSnapshot } from '../database/schemas/value-snapshot.schema';
import { Commitment } from '../database/schemas/commitment.schema';
import { Loan } from '../database/schemas/loan.schema';
import { CreditCard } from '../database/schemas/credit-card.schema';
import { NetWorthSnapshot } from '../database/schemas/net-worth-snapshot.schema';
import { Transaction } from '../database/schemas/transaction.schema';
import { commitmentStatus, nextDueDateFrom } from '../common/dates';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { TransactionsService } from '../transactions/transactions.service';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(BankAccount.name) private bankModel: Model<BankAccount>,
    @InjectModel(SavingsAccount.name)
    private savingsModel: Model<SavingsAccount>,
    @InjectModel(ValueSnapshot.name)
    private snapshotModel: Model<ValueSnapshot>,
    @InjectModel(Commitment.name) private commitmentModel: Model<Commitment>,
    @InjectModel(Loan.name) private loanModel: Model<Loan>,
    @InjectModel(CreditCard.name) private cardModel: Model<CreditCard>,
    @InjectModel(NetWorthSnapshot.name)
    private netWorthModel: Model<NetWorthSnapshot>,
    @InjectModel(Transaction.name) private txnModel: Model<Transaction>,
    private cards: CreditCardsService,
    private transactions: TransactionsService,
  ) {}

  private async savingsTotal(userId: Types.ObjectId): Promise<number> {
    const accounts = await this.savingsModel.find({ userId });
    let total = 0;
    for (const acc of accounts) {
      const latest = await this.snapshotModel
        .findOne({ accountId: acc._id })
        .sort({ date: -1 });
      total += latest?.value ?? 0;
    }
    return total;
  }

  private async sumField(
    model: Model<BankAccount> | Model<Loan> | Model<CreditCard>,
    userId: Types.ObjectId,
    field: string,
  ): Promise<number> {
    const [row] = await model.aggregate<{ total: number }>([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: `$${field}` } } },
    ]);
    return row?.total ?? 0;
  }

  async computeSummary(userId: string): Promise<DashboardSummary> {
    const uid = new Types.ObjectId(userId);
    // trigger the lazy statement roll before summing card balances
    await this.cards.list(userId);
    const [bankTotal, savingsTotal, loanTotal, cardTotal] = await Promise.all([
      this.sumField(this.bankModel, uid, 'currentBalance'),
      this.savingsTotal(uid),
      this.sumField(this.loanModel, uid, 'currentBalance'),
      this.sumField(this.cardModel, uid, 'currentBalance'),
    ]);
    const assets = bankTotal + savingsTotal;
    const liabilities = loanTotal + cardTotal;
    return {
      bankTotal,
      savingsTotal,
      loanTotal,
      cardTotal,
      assets,
      liabilities,
      netWorth: assets - liabilities,
    };
  }

  async balances(userId: string): Promise<BalanceSlice[]> {
    const uid = new Types.ObjectId(userId);
    const banks = await this.bankModel.find({ userId: uid });
    const savings = await this.savingsModel.find({ userId: uid });
    const slices: BalanceSlice[] = banks.map((b) => ({
      name: b.name,
      kind: 'bank' as const,
      value: b.currentBalance,
    }));
    for (const s of savings) {
      const latest = await this.snapshotModel
        .findOne({ accountId: s._id })
        .sort({ date: -1 });
      slices.push({ name: s.name, kind: s.type, value: latest?.value ?? 0 });
    }
    return slices;
  }

  async upcomingBills(userId: string, days: number): Promise<UpcomingBill[]> {
    const uid = new Types.ObjectId(userId);
    const horizon = new Date(Date.now() + days * 24 * 3600 * 1000);
    const bills: UpcomingBill[] = [];

    const commitments = await this.commitmentModel.find({
      userId: uid,
      active: true,
      nextDueDate: { $lte: horizon },
    });
    for (const c of commitments) {
      bills.push({
        source: 'commitment',
        name: c.name,
        amount: c.amount,
        dueDate: c.nextDueDate.toISOString(),
        status: commitmentStatus(c.nextDueDate),
      });
    }

    await this.cards.list(userId); // lazy statement roll
    const cards = await this.cardModel.find({
      userId: uid,
      statementBalance: { $gt: 0 },
    });
    for (const card of cards) {
      const dueDate = nextDueDateFrom(card.dueDay);
      if (dueDate <= horizon) {
        bills.push({
          source: 'creditCard',
          name: card.name,
          amount: card.statementBalance,
          dueDate: dueDate.toISOString(),
          status: commitmentStatus(dueDate),
        });
      }
    }

    return bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  async recentTransactions(
    userId: string,
    limit: number,
  ): Promise<TransactionDto[]> {
    const page = await this.transactions.list(userId, {
      page: '1',
      pageSize: String(Math.min(50, Math.max(1, limit))),
    });
    return page.items;
  }

  async netWorthTrend(userId: string): Promise<MonthPoint[]> {
    const uid = new Types.ObjectId(userId);
    const month = new Date().toISOString().slice(0, 7);
    const summary = await this.computeSummary(userId);
    await this.netWorthModel.updateOne(
      { userId: uid, month },
      { value: summary.netWorth, computedAt: new Date() },
      { upsert: true },
    );
    const points = await this.netWorthModel
      .find({ userId: uid })
      .sort({ month: 1 })
      .limit(24);
    return points.map((p) => ({ month: p.month, value: p.value }));
  }

  async spendingByCategory(
    userId: string,
    month: string,
  ): Promise<CategoryTotal[]> {
    const start = new Date(`${month}-01T00:00:00Z`);
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    );
    const rows = await this.txnModel.aggregate<{
      _id: string;
      total: number;
    }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          type: 'expense',
          date: { $gte: start, $lt: end },
        },
      },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
    ]);
    const byCategory = new Map(rows.map((r) => [r._id, r.total]));
    return EXPENSE_CATEGORIES.filter((c) => byCategory.has(c)).map((c) => ({
      category: c,
      total: byCategory.get(c)!,
    }));
  }

  async spendingTrend(userId: string, months: number): Promise<MonthPoint[]> {
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
    );
    const rows = await this.txnModel.aggregate<{
      _id: string;
      total: number;
    }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          type: { $in: ['expense', 'commitmentPayment', 'cardCharge'] },
          date: { $gte: start },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((r) => ({ month: r._id, value: r.total }));
  }
}
