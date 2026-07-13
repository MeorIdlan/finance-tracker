import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CommitmentDocument = HydratedDocument<Commitment>;

@Schema()
export class Commitment {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  amount: number; // integer sen

  @Prop({ required: true, min: 1, max: 31 })
  dueDayOfMonth: number;

  @Prop({ required: true })
  nextDueDate: Date;

  @Prop({ default: true })
  active: boolean;
}

export const CommitmentSchema = SchemaFactory.createForClass(Commitment);
