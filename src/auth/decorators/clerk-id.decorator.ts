import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ClerkId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.clerkId;
  },
);
