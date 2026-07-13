import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ValueSnapshotDocument = HydratedDocument<ValueSnapshot>;

@Schema()
export class ValueSnapshot {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  accountId: Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  value: number; // integer sen
}

export const ValueSnapshotSchema = SchemaFactory.createForClass(ValueSnapshot);
ValueSnapshotSchema.index({ accountId: 1, date: -1 });
