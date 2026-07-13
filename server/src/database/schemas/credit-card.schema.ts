import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CreditCardDocument = HydratedDocument<CreditCard>;

@Schema()
export class CreditCard {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  creditLimit: number; // integer sen

  @Prop({ default: 0 })
  statementBalance: number; // integer sen

  @Prop({ default: 0 })
  currentBalance: number; // integer sen

  @Prop({ required: true, min: 1, max: 28 })
  statementDay: number;

  @Prop({ required: true, min: 1, max: 28 })
  dueDay: number;

  @Prop({ default: () => new Date() })
  lastStatementAt: Date;
}

export const CreditCardSchema = SchemaFactory.createForClass(CreditCard);
