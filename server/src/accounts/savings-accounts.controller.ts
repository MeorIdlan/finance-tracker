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
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/session.service';
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
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.userId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSavingsAccountDto,
  ) {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateSavingsAccountDto,
  ) {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.remove(user.userId, id);
    return { ok: true };
  }

  @Get(':id/snapshots')
  listSnapshots(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listSnapshots(user.userId, id);
  }

  @Post(':id/snapshots')
  addSnapshot(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateSnapshotDto,
  ) {
    return this.service.addSnapshot(user.userId, id, dto);
  }
}
