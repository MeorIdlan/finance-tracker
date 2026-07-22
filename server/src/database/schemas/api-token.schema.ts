import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ApiTokenDocument = HydratedDocument<ApiToken>;
export type ApiTokenSource = 'manual' | 'oauth';

@Schema()
export class ApiToken {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  label: string;

  @Prop({ required: true, index: true })
  tokenHash: string;

  @Prop({ required: true })
  createdAt: Date;

  @Prop()
  lastUsedAt?: Date;

  @Prop({ required: true, enum: ['manual', 'oauth'] })
  source: ApiTokenSource;
}

export const ApiTokenSchema = SchemaFactory.createForClass(ApiToken);
