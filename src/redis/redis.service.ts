import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Lua script for atomic bid check-and-set.
 * KEYS[1] = highest_bid key, KEYS[2] = highest_bidder key
 * ARGV[1] = new bid amount, ARGV[2] = bidder id
 * Returns 1 if accepted, 0 if rejected.
 */
const ATOMIC_BID_SCRIPT = `
local currentBid = tonumber(redis.call('GET', KEYS[1]))
if currentBid == nil or tonumber(ARGV[1]) > currentBid then
  redis.call('SET', KEYS[1], ARGV[1])
  redis.call('SET', KEYS[2], ARGV[2])
  return 1
end
return 0
`;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService) {
    const url = config.get<string>('redis.url') ?? 'redis://localhost:6379';
    this.client = new Redis(url);
    this.client.on('error', (err) =>
      this.logger.error('Redis connection error', err),
    );
    this.client.on('connect', () => this.logger.log('Connected to Redis'));
  }

  getClient(): Redis {
    return this.client;
  }

  /** Build the Redis key for an item's highest bid */
  bidKey(auctionId: string, itemId: string): string {
    return `auction:${auctionId}:item:${itemId}:highest_bid`;
  }

  /** Build the Redis key for an item's highest bidder */
  bidderKey(auctionId: string, itemId: string): string {
    return `auction:${auctionId}:item:${itemId}:highest_bidder`;
  }

  private bidIdempotencyPendingKey(
    auctionId: string,
    itemId: string,
    bidderId: string,
    idempotencyKey: string,
  ): string {
    return `auction:${auctionId}:item:${itemId}:bidder:${bidderId}:idem:${idempotencyKey}:pending`;
  }

  private bidIdempotencyResultKey(
    auctionId: string,
    itemId: string,
    bidderId: string,
    idempotencyKey: string,
  ): string {
    return `auction:${auctionId}:item:${itemId}:bidder:${bidderId}:idem:${idempotencyKey}:result`;
  }

  /**
   * Atomically check if newBid > current highest bid.
   * If yes, sets the new bid + bidder and returns true.
   * If no, returns false. Zero race conditions.
   */
  async atomicBidCheck(
    auctionId: string,
    itemId: string,
    newBid: number,
    bidderId: string,
  ): Promise<boolean> {
    const result = await this.client.eval(
      ATOMIC_BID_SCRIPT,
      2,
      this.bidKey(auctionId, itemId),
      this.bidderKey(auctionId, itemId),
      newBid.toString(),
      bidderId,
    );
    return result === 1;
  }

  async claimBidIdempotency(
    auctionId: string,
    itemId: string,
    bidderId: string,
    idempotencyKey: string,
    ttlSec = 30,
  ): Promise<boolean> {
    const result = await this.client.set(
      this.bidIdempotencyPendingKey(
        auctionId,
        itemId,
        bidderId,
        idempotencyKey,
      ),
      '1',
      'EX',
      ttlSec,
      'NX',
    );
    return result === 'OK';
  }

  async getBidIdempotencyResult(
    auctionId: string,
    itemId: string,
    bidderId: string,
    idempotencyKey: string,
  ): Promise<{ accepted: boolean; reason?: string } | null> {
    const raw = await this.client.get(
      this.bidIdempotencyResultKey(auctionId, itemId, bidderId, idempotencyKey),
    );
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { accepted: boolean; reason?: string };
    } catch {
      return null;
    }
  }

  async storeBidIdempotencyResult(
    auctionId: string,
    itemId: string,
    bidderId: string,
    idempotencyKey: string,
    result: { accepted: boolean; reason?: string },
    ttlSec = 600,
  ): Promise<void> {
    const pipeline = this.client.pipeline();
    pipeline.set(
      this.bidIdempotencyResultKey(auctionId, itemId, bidderId, idempotencyKey),
      JSON.stringify(result),
      'EX',
      ttlSec,
    );
    pipeline.del(
      this.bidIdempotencyPendingKey(
        auctionId,
        itemId,
        bidderId,
        idempotencyKey,
      ),
    );
    await pipeline.exec();
  }

  /** Seed a fresh item into Redis (when item goes LIVE) */
  async seedItem(
    auctionId: string,
    itemId: string,
    startingPrice: number,
  ): Promise<void> {
    const pipeline = this.client.pipeline();
    pipeline.set(this.bidKey(auctionId, itemId), startingPrice.toString());
    pipeline.del(this.bidderKey(auctionId, itemId));
    await pipeline.exec();
  }

  /** Clear Redis keys for an item (when item ends) */
  async clearItem(auctionId: string, itemId: string): Promise<void> {
    await this.client.del(
      this.bidKey(auctionId, itemId),
      this.bidderKey(auctionId, itemId),
    );
  }

  /** Clear all keys for an auction (when auction ends) */
  async clearAuction(auctionId: string, itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    const keys = itemIds.flatMap((itemId) => [
      this.bidKey(auctionId, itemId),
      this.bidderKey(auctionId, itemId),
    ]);
    await this.client.del(...keys);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
