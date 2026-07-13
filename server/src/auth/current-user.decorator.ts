import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestUser } from '../auth-guard/session.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
