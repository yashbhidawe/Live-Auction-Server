import { Global, Module } from '@nestjs/common';
import { ClerkAuthGuard } from './guards/clerk-auth.guard';

@Global()
@Module({
  providers: [ClerkAuthGuard],
  exports: [ClerkAuthGuard],
})
export class AuthModule {}
