import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ChallengeType = 'registration' | 'authentication';
export type WebauthnChallengeDocument = HydratedDocument<WebauthnChallenge>;

@Schema()
export class WebauthnChallenge {
  @Prop({ required: true })
  challenge: string;

  @Prop({ lowercase: true, trim: true })
  email?: string;

  @Prop({ type: Types.ObjectId })
  userId?: Types.ObjectId;

  @Prop({ required: true, enum: ['registration', 'authentication'] })
  type: ChallengeType;

  @Prop({ required: true })
  expiresAt: Date;
}

export const WebauthnChallengeSchema =
  SchemaFactory.createForClass(WebauthnChallenge);
WebauthnChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
