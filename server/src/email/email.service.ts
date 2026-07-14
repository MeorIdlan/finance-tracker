import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';
import { EmailQuotaUsage } from '../database/schemas/email-quota.schema';

@Injectable()
export class EmailService {
  private mailer: MailerSend;
  private from: string;
  private quota: number;

  constructor(
    private config: ConfigService,
    @InjectModel(EmailQuotaUsage.name)
    private quotaModel: Model<EmailQuotaUsage>,
  ) {
    this.mailer = new MailerSend({
      apiKey: this.config.getOrThrow<string>('MAILERSEND_API_KEY'),
    });
    this.from = this.config.getOrThrow<string>('MAILERSEND_FROM_EMAIL');
    this.quota = parseInt(this.config.get('EMAIL_MONTHLY_QUOTA', '3000'), 10);
  }

  private yearMonth(): string {
    return new Date().toISOString().slice(0, 7); // e.g. "2026-07"
  }

  private async reserveQuotaSlot(): Promise<void> {
    // Atomically increment only while below quota; null result = exhausted
    // or the row does not exist yet. On upsert, Mongo applies $inc to the
    // (implicit zero) starting value, so a newly-created row ends at 1.
    const yearMonth = this.yearMonth();
    let updated;
    try {
      updated = await this.quotaModel.findOneAndUpdate(
        { yearMonth, count: { $lt: this.quota } },
        { $inc: { count: 1 } },
        { new: true, upsert: true },
      );
    } catch (err) {
      // Two concurrent requests can both attempt to upsert the first row
      // for a new month; only one insert wins and the other throws a
      // duplicate-key error. The row now exists, so retry without upsert.
      if ((err as { code?: number }).code === 11000) {
        updated = await this.quotaModel.findOneAndUpdate(
          { yearMonth, count: { $lt: this.quota } },
          { $inc: { count: 1 } },
          { new: true },
        );
      } else {
        throw err;
      }
    }
    if (updated) return;
    throw new ServiceUnavailableException(
      'Monthly email quota reached. Please try again later.',
    );
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    await this.reserveQuotaSlot();
    if (process.env.NODE_ENV !== 'production') {
      // Lets a dev server (or a scripted e2e check driving the browser)
      // read the code from stdout instead of a real inbox.
      console.log(`[dev] OTP for ${to}: ${code}`);
    }
    const params = new EmailParams()
      .setFrom(new Sender(this.from, 'Finance Tracker'))
      .setTo([new Recipient(to)])
      .setSubject('Your Finance Tracker verification code')
      .setText(
        `Your verification code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`,
      );
    await this.mailer.email.send(params);
  }
}
