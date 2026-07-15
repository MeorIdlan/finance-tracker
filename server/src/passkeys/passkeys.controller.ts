import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PasskeySummary } from '@finance/shared';
import { Credential } from '../database/schemas/credential.schema';
import { AuthGuard } from '../auth-guard/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth-guard/session.service';
import { AuditLogService } from '../audit/audit.service';

@Controller('passkeys')
@UseGuards(AuthGuard)
export class PasskeysController {
  constructor(
    @InjectModel(Credential.name) private credModel: Model<Credential>,
    private audit: AuditLogService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<PasskeySummary[]> {
    const creds = await this.credModel
      .find({ userId: new Types.ObjectId(user.userId) })
      .sort({ createdAt: -1 });
    return creds.map((c) => ({
      id: c._id.toHexString(),
      deviceLabel: c.deviceLabel,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const uid = new Types.ObjectId(user.userId);
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    // Deviation from brief: verify existence/ownership before checking
    // "is this the last passkey" so deleting a nonexistent/other-user
    // credential always 404s, even when the caller only has one passkey.
    const existing = await this.credModel.findOne({
      _id: new Types.ObjectId(id),
      userId: uid,
    });
    if (!existing) throw new NotFoundException();
    const count = await this.credModel.countDocuments({ userId: uid });
    if (count <= 1) {
      throw new BadRequestException('Cannot remove your last passkey.');
    }
    const cred = await this.credModel.findOneAndDelete({
      _id: new Types.ObjectId(id),
      userId: uid,
    });
    if (!cred) throw new NotFoundException();
    await this.audit.log({
      userId: user.userId,
      action: 'passkey.removed',
      entityType: 'Credential',
      entityId: cred.credentialId,
      metadata: { deviceLabel: cred.deviceLabel },
    });
    return { ok: true };
  }
}
