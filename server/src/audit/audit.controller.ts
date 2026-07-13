import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth-guard/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth-guard/session.service';
import { AuditLogService } from './audit.service';

@Controller('audit-log')
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private audit: AuditLogService) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    return this.audit.list(user.userId, p, ps);
  }
}
