import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SessionScope = 'pending_passkey' | 'full';
export type SessionDocument = HydratedDocument<Session>;

@Schema()
export class Session {
  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['pending_passkey', 'full'] })
  scope: SessionScope;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
