import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EmailQuotaUsageDocument = HydratedDocument<EmailQuotaUsage>;

@Schema()
export class EmailQuotaUsage {
  @Prop({ required: true, unique: true })
  yearMonth: string;

  @Prop({ default: 0 })
  count: number;
}

export const EmailQuotaUsageSchema =
  SchemaFactory.createForClass(EmailQuotaUsage);
