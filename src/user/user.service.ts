import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  private async getAvailableDisplayName(
    baseDisplayName: string,
    excludeUserId?: string,
  ): Promise<string> {
    const base = baseDisplayName.trim().slice(0, 64) || 'User';
    let candidate = base;
    let suffix = 0;
    while (true) {
      const taken = await this.prisma.user.findUnique({
        where: { displayName: candidate },
        select: { id: true },
      });
      if (!taken || taken.id === excludeUserId) return candidate;
      candidate = `${base}_${++suffix}`;
    }
  }

  async create(displayName: string) {
    // If user with this name already exists, return them (idempotent register)
    const existing = await this.prisma.user.findUnique({
      where: { displayName },
    });
    if (existing) return existing;

    return this.prisma.user.create({
      data: { displayName },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async exists(id: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    return user !== null;
  }

  async updateDisplayNameFromClerk(clerkId: string, displayName: string) {
    const preferredDisplayName = displayName.trim();
    if (!preferredDisplayName) {
      return this.syncFromClerk(clerkId);
    }

    const existing = await this.prisma.user.findUnique({
      where: { clerkId },
    });
    if (!existing) {
      return this.syncFromClerk(clerkId, preferredDisplayName);
    }

    const candidate = await this.getAvailableDisplayName(
      preferredDisplayName,
      existing.id,
    );
    if (candidate === existing.displayName) return existing;

    return this.prisma.user.update({
      where: { id: existing.id },
      data: { displayName: candidate },
    });
  }

  /** Sync or create user from Clerk. Returns app user. */
  async syncFromClerk(clerkId: string, displayName?: string) {
    const preferredDisplayName = displayName?.trim();
    const existing = await this.prisma.user.findUnique({
      where: { clerkId },
    });
    if (existing) {
      if (!preferredDisplayName || preferredDisplayName === existing.displayName) {
        return existing;
      }
      const candidate = await this.getAvailableDisplayName(
        preferredDisplayName,
        existing.id,
      );
      if (candidate === existing.displayName) return existing;
      return this.prisma.user.update({
        where: { id: existing.id },
        data: { displayName: candidate },
      });
    }

    const candidate = await this.getAvailableDisplayName(
      preferredDisplayName || `User_${clerkId.slice(-8)}`,
    );
    return this.prisma.user.create({
      data: { clerkId, displayName: candidate },
    });
  }
}
