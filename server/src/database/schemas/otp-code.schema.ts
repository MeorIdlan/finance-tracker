import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OtpPurpose = 'register' | 'recovery';
export type OtpCodeDocument = HydratedDocument<OtpCode>;

@Schema()
export class OtpCode {
  @Prop({ required: true, index: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  codeHash: string;

  @Prop({ required: true, enum: ['register', 'recovery'] })
  purpose: OtpPurpose;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop()
  consumedAt?: Date;

  @Prop({ default: 0 })
  attempts: number;
}

export const OtpCodeSchema = SchemaFactory.createForClass(OtpCode);
OtpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
OtpCodeSchema.index({ email: 1, purpose: 1 }, { unique: true });
