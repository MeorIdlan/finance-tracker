import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BankAccountDocument = HydratedDocument<BankAccount>;

@Schema()
export class BankAccount {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  openingBalance: number; // integer sen

  @Prop({ required: true })
  currentBalance: number; // integer sen, maintained atomically by transactions

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);
