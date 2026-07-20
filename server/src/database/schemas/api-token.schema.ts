import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ApiTokenDocument = HydratedDocument<ApiToken>;

@Schema()
export class ApiToken {
  @Prop({ type: Types.ObjectId, required: true, unique: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  tokenHash: string;

  @Prop({ required: true })
  createdAt: Date;

  @Prop()
  lastUsedAt?: Date;
}

export const ApiTokenSchema = SchemaFactory.createForClass(ApiToken);
