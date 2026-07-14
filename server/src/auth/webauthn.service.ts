import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  Credential,
  CredentialDocument,
} from '../database/schemas/credential.schema';
import { WebauthnChallenge } from '../database/schemas/webauthn-challenge.schema';
import { User } from '../database/schemas/user.schema';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class WebauthnService {
  private rpId: string;
  private rpName: string;
  private origin: string;

  constructor(
    config: ConfigService,
    @InjectModel(Credential.name) private credModel: Model<Credential>,
    @InjectModel(WebauthnChallenge.name)
    private challengeModel: Model<WebauthnChallenge>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {
    this.rpId = config.get('WEBAUTHN_RP_ID', 'localhost');
    this.rpName = config.get('WEBAUTHN_RP_NAME', 'Finance Tracker');
    this.origin = config.get('WEBAUTHN_ORIGIN', 'http://localhost:5173');
  }

  async registrationOptions(
    userId: string,
    email: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const uid = new Types.ObjectId(userId);
    const creds = await this.credModel.find({ userId: uid });
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userName: email,
      attestationType: 'none',
      excludeCredentials: creds.map((c) => ({ id: c.credentialId })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });
    await this.challengeModel.findOneAndUpdate(
      { userId: uid, type: 'registration' },
      {
        challenge: options.challenge,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
      { upsert: true },
    );
    return options;
  }

  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    deviceLabel: string,
  ): Promise<CredentialDocument> {
    const uid = new Types.ObjectId(userId);
    const challengeDoc = await this.challengeModel.findOne({
      userId: uid,
      type: 'registration',
      expiresAt: { $gt: new Date() },
    });
    if (!challengeDoc) {
      throw new BadRequestException('No pending passkey challenge.');
    }
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeDoc.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
    });
    if (!result.verified || !result.registrationInfo) {
      throw new UnauthorizedException('Passkey verification failed.');
    }
    const { credential } = result.registrationInfo;
    const created = await this.credModel.create({
      userId: uid,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      deviceLabel,
    });
    await challengeDoc.deleteOne();
    return created;
  }

  async authenticationOptions(email: string): Promise<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const user = await this.userModel.findOne({
      email: email.toLowerCase(),
      emailVerified: true,
    });
    if (!user) throw new NotFoundException('No account for this email.');
    const creds = await this.credModel.find({ userId: user._id });
    if (creds.length === 0) {
      throw new NotFoundException(
        'No passkeys registered. Use account recovery.',
      );
    }
    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: 'preferred',
      allowCredentials: creds.map((c) => ({ id: c.credentialId })),
    });
    const doc = await this.challengeModel.create({
      challenge: options.challenge,
      userId: user._id,
      type: 'authentication',
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
    return { challengeId: doc._id.toHexString(), options };
  }

  async verifyAuthentication(
    challengeId: string,
    response: AuthenticationResponseJSON,
  ): Promise<Types.ObjectId> {
    if (!Types.ObjectId.isValid(challengeId)) {
      throw new UnauthorizedException('Login challenge expired.');
    }
    const challengeDoc = await this.challengeModel.findOne({
      _id: new Types.ObjectId(challengeId),
      type: 'authentication',
      expiresAt: { $gt: new Date() },
    });
    if (!challengeDoc || !challengeDoc.userId) {
      throw new UnauthorizedException('Login challenge expired.');
    }
    const cred = await this.credModel.findOne({
      credentialId: response.id,
      userId: challengeDoc.userId,
    });
    if (!cred) throw new UnauthorizedException('Unknown passkey.');
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeDoc.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(cred.publicKey),
        counter: cred.counter,
      },
    });
    if (!result.verified) {
      throw new UnauthorizedException('Passkey verification failed.');
    }
    cred.counter = result.authenticationInfo.newCounter;
    await cred.save();
    await challengeDoc.deleteOne();
    return challengeDoc.userId;
  }
}
