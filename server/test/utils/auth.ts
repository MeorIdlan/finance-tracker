import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { User } from '../../src/database/schemas/user.schema';
import { Session } from '../../src/database/schemas/session.schema';

export async function seedAuthedUser(
  app: INestApplication,
  email = 'fin@user.com',
): Promise<{ userId: Types.ObjectId; cookie: string }> {
  const userModel: Model<User> = app.get(getModelToken(User.name));
  const sessionModel: Model<Session> = app.get(getModelToken(Session.name));
  const user = await userModel.create({ email, emailVerified: true });
  const token = randomBytes(16).toString('base64url');
  await sessionModel.create({
    tokenHash: createHash('sha256').update(token).digest('hex'),
    userId: user._id,
    scope: 'full',
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { userId: user._id, cookie: `sid=${token}` };
}
