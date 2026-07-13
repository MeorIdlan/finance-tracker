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
  | 'cardCharge'
  | 'transfer';

export interface AuthUser {
  id: string;
  email: string;
}

export interface PasskeySummary {
  id: string;
  deviceLabel: string;
  createdAt: string;
}
