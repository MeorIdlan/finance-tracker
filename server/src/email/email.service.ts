import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import FormData from 'form-data';
import Mailgun from 'mailgun.js';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private mailer: ReturnType<Mailgun['client']>;
  private domain: string;
  private from: string;

  constructor(private config: ConfigService) {
    const mailgun = new Mailgun(FormData);
    this.mailer = mailgun.client({
      username: 'api',
      key: this.config.getOrThrow<string>('MAILGUN_API_KEY'),
    });
    this.domain = this.config.getOrThrow<string>('MAILGUN_DOMAIN');
    this.from = this.config.getOrThrow<string>('MAILGUN_FROM_EMAIL');
  }

  // Mailgun enforces the actual cap account-side; this is a pre-check so
  // an exhausted quota surfaces as a clean 503 instead of a raw send
  // failure. If the limit check itself errors (network blip, or no custom
  // limit configured yet), fail open and let the send attempt proceed.
  private async checkSendLimit(): Promise<void> {
    let usage;
    try {
      usage = await this.mailer.customMessageLimit.get();
    } catch (err) {
      this.logger.warn(
        `Could not verify Mailgun send limit, proceeding anyway: ${err}`,
      );
      return;
    }
    if (usage.current >= usage.limit) {
      throw new ServiceUnavailableException(
        'Monthly email quota reached. Please try again later.',
      );
    }
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    await this.checkSendLimit();
    if (process.env.NODE_ENV !== 'production') {
      // Lets a dev server (or a scripted e2e check driving the browser)
      // read the code from stdout instead of a real inbox.
      console.log(`[dev] OTP for ${to}: ${code}`);
    }
    await this.mailer.messages.create(this.domain, {
      from: `Finance Tracker <${this.from}>`,
      to: [to],
      subject: 'Your Finance Tracker verification code',
      text: `Your verification code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`,
    });
  }
}
