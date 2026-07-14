import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SavingsAccountDocument = HydratedDocument<SavingsAccount>;

@Schema()
export class SavingsAccount {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, enum: ['savings', 'investment'] })
  type: 'savings' | 'investment';

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const SavingsAccountSchema =
  SchemaFactory.createForClass(SavingsAccount);
