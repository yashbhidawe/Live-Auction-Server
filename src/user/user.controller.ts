import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { ClerkId } from '../auth/decorators/clerk-id.decorator';

@Controller('users')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly userService: UserService) {}

  @Post()
  create(@Body('displayName') displayName: string) {
    return this.userService.create(displayName);
  }

  @Post('sync')
  @UseGuards(ClerkAuthGuard)
  async sync(
    @ClerkId() clerkId: string,
    @Body('displayName') displayName?: string,
  ) {
    this.logger.log(`POST /users/sync clerkId=${clerkId} displayName=${displayName ?? '(none)'}`);
    const user = await this.userService.syncFromClerk(clerkId, displayName);
    this.logger.log(`Sync result: id=${user.id} name=${user.displayName}`);
    return user;
  }

  @Patch('me')
  @UseGuards(ClerkAuthGuard)
  async updateMe(
    @ClerkId() clerkId: string,
    @Body('displayName') displayName?: string,
  ) {
    const trimmed = displayName?.trim();
    if (!trimmed) {
      return this.userService.syncFromClerk(clerkId);
    }
    this.logger.log(`PATCH /users/me clerkId=${clerkId} displayName=${trimmed}`);
    const user = await this.userService.updateDisplayNameFromClerk(
      clerkId,
      trimmed,
    );
    this.logger.log(`Profile updated: id=${user.id} name=${user.displayName}`);
    return user;
  }

  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.findById(id);
  }
}
