import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/session.service';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private service: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() user: RequestUser) {
    return this.service.computeSummary(user.userId);
  }

  @Get('balances')
  balances(@CurrentUser() user: RequestUser) {
    return this.service.balances(user.userId);
  }

  @Get('upcoming-bills')
  upcomingBills(
    @CurrentUser() user: RequestUser,
    @Query('days') days = '14',
  ) {
    const d = Math.min(90, Math.max(1, parseInt(days, 10) || 14));
    return this.service.upcomingBills(user.userId, d);
  }

  @Get('recent-transactions')
  recent(@CurrentUser() user: RequestUser, @Query('limit') limit = '10') {
    return this.service.recentTransactions(
      user.userId,
      parseInt(limit, 10) || 10,
    );
  }

  @Get('net-worth-trend')
  netWorthTrend(@CurrentUser() user: RequestUser) {
    return this.service.netWorthTrend(user.userId);
  }

  @Get('spending-by-category')
  spendingByCategory(
    @CurrentUser() user: RequestUser,
    @Query('month') month?: string,
  ) {
    const m =
      month && /^\d{4}-\d{2}$/.test(month)
        ? month
        : new Date().toISOString().slice(0, 7);
    return this.service.spendingByCategory(user.userId, m);
  }

  @Get('spending-trend')
  spendingTrend(
    @CurrentUser() user: RequestUser,
    @Query('months') months = '12',
  ) {
    const m = Math.min(36, Math.max(1, parseInt(months, 10) || 12));
    return this.service.spendingTrend(user.userId, m);
  }
}
