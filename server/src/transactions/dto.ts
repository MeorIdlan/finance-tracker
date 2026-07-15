import {
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EXPENSE_CATEGORIES,
  ExpenseCategory,
  SourceType,
  TransactionType,
} from '@finance/shared';

const TYPES: TransactionType[] = [
  'income',
  'expense',
  'commitmentPayment',
  'loanPayment',
  'cardPayment',
  'transfer',
];

const SOURCE_TYPES: SourceType[] = ['bankAccount', 'creditCard'];

export class CreateTransactionDto {
  @IsIn(TYPES)
  type: TransactionType;

  @IsInt()
  @Min(1)
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @IsIn(SOURCE_TYPES)
  sourceType: SourceType;

  @IsMongoId()
  sourceId: string;

  @IsOptional()
  @IsMongoId()
  toAccountId?: string;

  @IsOptional()
  @IsMongoId()
  linkedEntityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class UpdateTransactionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class ListTransactionsQuery {
  @IsOptional()
  @IsIn(TYPES)
  type?: TransactionType;

  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @IsOptional()
  @IsMongoId()
  sourceId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
