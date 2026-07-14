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
import { RequestUser } from '../auth-guard/session.service';
import { LoansService } from './loans.service';
import { CreateLoanDto, UpdateLoanDto } from './dto';

@Controller('loans')
@UseGuards(AuthGuard)
export class LoansController {
  constructor(private service: LoansService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateLoanDto) {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateLoanDto,
  ) {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.remove(user.userId, id);
    return { ok: true };
  }
}
