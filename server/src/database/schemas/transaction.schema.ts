import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ExpenseCategory, SourceType, TransactionType } from '@finance/shared';

export type TransactionDocument = HydratedDocument<Transaction>;

const TYPES: TransactionType[] = [
  'income',
  'expense',
  'commitmentPayment',
  'loanPayment',
  'cardPayment',
  'transfer',
];

const SOURCE_TYPES: SourceType[] = ['bankAccount', 'creditCard'];

@Schema()
export class Transaction {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: TYPES })
  type: TransactionType;

  @Prop({ required: true })
  amount: number; // integer sen, always positive

  @Prop({ required: true })
  date: Date;

  @Prop()
  category?: ExpenseCategory;

  @Prop({ required: true, enum: SOURCE_TYPES })
  sourceType: SourceType;

  @Prop({ type: Types.ObjectId, required: true })
  sourceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  toAccountId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  linkedEntityId?: Types.ObjectId;

  @Prop({ trim: true })
  note?: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
TransactionSchema.index({ userId: 1, date: -1, _id: -1 });
