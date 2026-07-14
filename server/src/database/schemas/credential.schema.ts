import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CredentialDocument = HydratedDocument<Credential>;

@Schema()
export class Credential {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true })
  credentialId: string;

  @Prop({ type: Buffer, required: true })
  publicKey: Buffer;

  @Prop({ required: true, default: 0 })
  counter: number;

  @Prop({ default: 'Passkey' })
  deviceLabel: string;

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const CredentialSchema = SchemaFactory.createForClass(Credential);
