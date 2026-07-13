import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomInt } from 'crypto';
import { OtpCode, OtpPurpose } from '../database/schemas/otp-code.schema';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

@Injectable()
export class OtpService {
  constructor(@InjectModel(OtpCode.name) private otpModel: Model<OtpCode>) {}

  async issue(email: string, purpose: OtpPurpose): Promise<string> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.otpModel.findOneAndUpdate(
      { email: email.toLowerCase(), purpose },
      {
        codeHash: hash(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        consumedAt: null,
        attempts: 0,
      },
      { upsert: true },
    );
    return code;
  }

  async verify(
    email: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<boolean> {
    const doc = await this.otpModel.findOne({
      email: email.toLowerCase(),
      purpose,
    });
    if (
      !doc ||
      doc.consumedAt ||
      doc.expiresAt < new Date() ||
      doc.attempts >= MAX_ATTEMPTS
    ) {
      return false;
    }
    if (doc.codeHash !== hash(code)) {
      await this.otpModel.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
      return false;
    }
    await this.otpModel.updateOne({ _id: doc._id }, { consumedAt: new Date() });
    return true;
  }
}
