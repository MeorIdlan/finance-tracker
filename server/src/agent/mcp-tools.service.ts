import { Injectable } from '@nestjs/common';
import {
  BankAccountDto,
  CommitmentDto,
  CreditCardDto,
  DashboardSummary,
  LoanDto,
  Paginated,
  TransactionDto,
  UpcomingBill,
} from '@finance/shared';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateTransactionDto, ListTransactionsQuery } from '../transactions/dto';
import { DashboardService } from '../dashboard/dashboard.service';
import { BankAccountsService } from '../accounts/bank-accounts.service';
import { CommitmentsService } from '../commitments/commitments.service';
import { LoansService } from '../loans/loans.service';
import { CreditCardsService } from '../credit-cards/credit-cards.service';

export interface SummaryResult {
  summary: DashboardSummary;
  upcomingBills: UpcomingBill[];
}

export interface AccountsResult {
  bankAccounts: BankAccountDto[];
  commitments: CommitmentDto[];
  loans: LoanDto[];
  creditCards: CreditCardDto[];
}

@Injectable()
export class McpToolsService {
  constructor(
    private transactions: TransactionsService,
    private dashboard: DashboardService,
    private bankAccounts: BankAccountsService,
    private commitments: CommitmentsService,
    private loans: LoansService,
    private cards: CreditCardsService,
  ) {}

  createTransaction(
    userId: string,
    args: CreateTransactionDto,
  ): Promise<TransactionDto> {
    return this.transactions.create(userId, args, 'agent');
  }

  async getSummary(userId: string): Promise<SummaryResult> {
    const [summary, upcomingBills] = await Promise.all([
      this.dashboard.computeSummary(userId),
      this.dashboard.upcomingBills(userId, 14),
    ]);
    return { summary, upcomingBills };
  }

  listTransactions(
    userId: string,
    args: ListTransactionsQuery,
  ): Promise<Paginated<TransactionDto>> {
    return this.transactions.list(userId, args);
  }

  async listAccounts(userId: string): Promise<AccountsResult> {
    const [bankAccounts, commitments, loans, creditCards] = await Promise.all([
      this.bankAccounts.list(userId),
      this.commitments.list(userId),
      this.loans.list(userId),
      this.cards.list(userId),
    ]);
    return { bankAccounts, commitments, loans, creditCards };
  }
}
