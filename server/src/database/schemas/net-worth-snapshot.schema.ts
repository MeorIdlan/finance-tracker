import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NetWorthSnapshotDocument = HydratedDocument<NetWorthSnapshot>;

@Schema()
export class NetWorthSnapshot {
  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  month: string; // "2026-07"

  @Prop({ required: true })
  value: number; // integer sen

  @Prop({ default: () => new Date() })
  computedAt: Date;
}

export const NetWorthSnapshotSchema =
  SchemaFactory.createForClass(NetWorthSnapshot);
NetWorthSnapshotSchema.index({ userId: 1, month: 1 }, { unique: true });
