export const EXPENSE_CATEGORIES = [
  'Food',
  'Transport',
  'Entertainment',
  'Bills',
  'Shopping',
  'Health',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type TransactionType =
  | 'income'
  | 'expense'
  | 'commitmentPayment'
  | 'loanPayment'
  | 'cardPayment'
  | 'transfer';

export type SourceType = 'bankAccount' | 'creditCard';

export interface AuthUser {
  id: string;
  email: string;
}

export interface PasskeySummary {
  id: string;
  deviceLabel: string;
  createdAt: string;
}

// ---- Financial DTOs (Plan 2) ----
// All money values are integer sen (RM 12.34 === 1234). All dates are ISO strings.

export interface BankAccountDto {
  id: string;
  name: string;
  openingBalance: number;
  currentBalance: number;
  createdAt: string;
}

export interface SavingsAccountDto {
  id: string;
  name: string;
  type: 'savings' | 'investment';
  latestValue: number | null;
  latestValueDate: string | null;
  createdAt: string;
}

export interface ValueSnapshotDto {
  id: string;
  date: string;
  value: number;
}

export type CommitmentStatus = 'overdue' | 'dueSoon' | 'upcoming';

export interface CommitmentDto {
  id: string;
  name: string;
  amount: number;
  dueDayOfMonth: number;
  nextDueDate: string;
  active: boolean;
  status: CommitmentStatus;
}

export interface LoanDto {
  id: string;
  name: string;
  principal: number;
  interestRate: number;
  currentBalance: number;
  startDate: string;
}

export interface CreditCardDto {
  id: string;
  name: string;
  creditLimit: number;
  statementBalance: number;
  currentBalance: number;
  statementDay: number;
  dueDay: number;
}

export interface TransactionDto {
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  category?: ExpenseCategory;
  sourceType: SourceType;
  sourceId: string;
  toAccountId?: string;
  linkedEntityId?: string;
  note?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

// ---- Dashboard DTOs (Plan 3) ----

export interface DashboardSummary {
  bankTotal: number;
  savingsTotal: number;
  loanTotal: number;
  cardTotal: number;
  assets: number;
  liabilities: number;
  netWorth: number;
}

export interface BalanceSlice {
  name: string;
  kind: 'bank' | 'savings' | 'investment';
  value: number;
}

export interface UpcomingBill {
  source: 'commitment' | 'creditCard';
  name: string;
  amount: number;
  dueDate: string;
  status: CommitmentStatus;
}

export interface MonthPoint {
  month: string; // "2026-07"
  value: number;
}

export interface CategoryTotal {
  category: ExpenseCategory;
  total: number;
}

// ---- Agent MCP endpoint DTOs ----

export type AgentTokenSource = 'manual' | 'oauth';

export interface AgentTokenDto {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  source: AgentTokenSource;
}
