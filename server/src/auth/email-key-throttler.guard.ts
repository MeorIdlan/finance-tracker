import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Name for this guard's own throttler bucket. It is deliberately NOT
// registered in the global ThrottlerModule.forRoot() config. Both the global
// APP_GUARD ThrottlerGuard and this guard read @Throttle() route metadata by
// name; if this guard reused the global 'default' name, the global guard
// would ALSO enforce the route's 5/hour override -- but using its own
// IP-only tracker (ignoring email), which would incorrectly block every
// other email from the same IP. Using a distinct name means only this guard
// (which hardcodes it into `this.throttlers` below) ever applies it.
export const AUTH_EMAIL_THROTTLER_NAME = 'authEmail';

@Injectable()
export class EmailKeyThrottlerGuard extends ThrottlerGuard {
  // Deliberately does NOT call super.onModuleInit() to avoid inheriting DI-injected ThrottlerModuleOptions.
  // Reverting to inherited config would reintroduce IP-only double-throttling: the global APP_GUARD
  // ThrottlerGuard would share this guard's throttler name/config and also enforce the 5/hour limit,
  // using only IP (not email), blocking all unrelated emails from the same IP and defeating this guard's purpose.
  async onModuleInit(): Promise<void> {
    this.throttlers = [
      { name: AUTH_EMAIL_THROTTLER_NAME, ttl: 3_600_000, limit: 5 },
    ];
    this.commonOptions = {
      getTracker: this.getTracker.bind(this),
      generateKey: this.generateKey.bind(this),
    };
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = (req as { ip?: string }).ip ?? 'unknown';
    const body = (req as { body?: { email?: string } }).body;
    const email = body?.email ?? 'unknown';
    return `${ip}:${email}`;
  }

  // The base ThrottlerGuard.generateKey() includes context.getHandler().name
  // in the storage key, which would give register and recover independent
  // buckets even for the same IP+email. Drop the handler name here so both
  // routes collide into one shared bucket per IP+email pair, per design intent.
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    return `${context.getClass().name}-${name}-${suffix}`;
  }
}
