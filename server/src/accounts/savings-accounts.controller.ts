import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth-guard/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth-guard/session.service';
import { SavingsAccountsService } from './savings-accounts.service';
import {
  CreateSavingsAccountDto,
  CreateSnapshotDto,
  UpdateSavingsAccountDto,
} from './dto';

@Controller('accounts/savings')
@UseGuards(AuthGuard)
export class SavingsAccountsController {
  constructor(private service: SavingsAccountsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.userId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSavingsAccountDto,
  ) {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSavingsAccountDto,
  ) {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.service.remove(user.userId, id);
    return { ok: true };
  }

  @Get(':id/snapshots')
  listSnapshots(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.listSnapshots(user.userId, id);
  }

  @Post(':id/snapshots')
  addSnapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateSnapshotDto,
  ) {
    return this.service.addSnapshot(user.userId, id, dto);
  }
}
