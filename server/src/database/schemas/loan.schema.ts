import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LoanDocument = HydratedDocument<Loan>;

@Schema()
export class Loan {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  principal: number; // integer sen

  @Prop({ required: true })
  interestRate: number; // annual %, reference only in v1

  @Prop({ required: true })
  currentBalance: number; // integer sen

  @Prop({ default: () => new Date() })
  startDate: Date;
}

export const LoanSchema = SchemaFactory.createForClass(Loan);
