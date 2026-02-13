import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { AuctionEngine } from './engine';
import type {
  AuctionState,
  CreateAuctionInput,
  AdvanceToNextItemResult,
} from './engine';
import { RedisService } from '../redis/redis.service';
import { AuctionPersistenceService } from './auction-persistence.service';

const AUCTION_ROOM_PREFIX = 'auction:';

export type AuctionStateChangeEvent =
  | { event: 'auction_state'; auctionId: string; state: AuctionState }
  | {
      event: 'item_sold';
      auctionId: string;
      itemId: string;
      winnerId: string | null;
      finalPrice: number;
      sold: boolean;
      state: AuctionState;
    }
  | {
      event: 'auction_ended';
      auctionId: string;
      results: Array<{
        itemId: string;
        winnerId: string | null;
        finalPrice: number;
      }>;
      state: AuctionState;
    };

interface AuctionEntry {
  engine: AuctionEngine;
  itemTimer: ReturnType<typeof setTimeout> | null;
  itemEndTimeMs: number | null;
}

type BidOutcome = { accepted: boolean; reason?: string };

@Injectable()
export class AuctionService implements OnModuleInit {
  private readonly auctions = new Map<string, AuctionEntry>();
  private readonly eventEmitter = new EventEmitter();
  private readonly logger = new Logger(AuctionService.name);
  private readonly auctionLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly redis: RedisService,
    private readonly persistence: AuctionPersistenceService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  RECOVERY: re-hydrate from DB on startup                           */
  /* ------------------------------------------------------------------ */

  async onModuleInit(): Promise<void> {
    const activeAuctions = await this.persistence.loadActiveAuctions();
    for (const state of activeAuctions) {
      const engine = new AuctionEngine(state.id, {
        sellerId: state.sellerId,
        items: state.items,
      });
      engine.setState(state);

      const entry: AuctionEntry = {
        engine,
        itemTimer: null,
        itemEndTimeMs: null,
      };
      this.auctions.set(state.id, entry);

      // If auction is LIVE, seed Redis for current item and schedule timer
      if (state.status === 'LIVE') {
        const currentItem = state.items[state.currentItemIndex];
        if (currentItem && currentItem.status === 'LIVE') {
          await this.redis.seedItem(
            state.id,
            currentItem.id,
            currentItem.highestBid,
          );
          // If there was already a highest bidder, re-set it in Redis
          if (currentItem.highestBidderId) {
            await this.redis.atomicBidCheck(
              state.id,
              currentItem.id,
              currentItem.highestBid,
              currentItem.highestBidderId,
            );
          }
          this.scheduleItemExpiry(state.id);
        }
      }
    }
    this.logger.log(`Recovered ${activeAuctions.length} auction(s) from DB`);
  }

  /* ------------------------------------------------------------------ */
  /*  PUBLIC API                                                         */
  /* ------------------------------------------------------------------ */

  getEventEmitter(): EventEmitter {
    return this.eventEmitter;
  }

  getRoomName(auctionId: string): string {
    return `${AUCTION_ROOM_PREFIX}${auctionId}`;
  }

  /** Create auction: validate seller, create engine, persist to DB */
  async createAuction(
    input: CreateAuctionInput,
  ): Promise<AuctionState | { error: string }> {
    // Validate seller exists
    const sellerExists = await this.persistence.validateSellerExists(
      input.sellerId,
    );
    if (!sellerExists) {
      return { error: 'Seller not found. Create a user first.' };
    }

    const id = crypto.randomUUID();
    const engine = new AuctionEngine(id, input);
    const state = engine.getState() as AuctionState;

    // Persist to DB (source of truth)
    await this.persistence.persistAuction(state);

    // Cache in memory
    this.auctions.set(id, { engine, itemTimer: null, itemEndTimeMs: null });

    return state;
  }

  /** List all auctions from DB (includes ended) */
  async listAuctions(): Promise<
    Array<{
      id: string;
      sellerId: string;
      status: string;
      sellerName: string;
      firstItemName: string | null;
      itemCount: number;
    }>
  > {
    return this.persistence.listAuctions();
  }

  /** Get state: in-memory first, fallback to DB for ended auctions */
  async getState(
    auctionId: string,
  ): Promise<(AuctionState & { itemEndTime?: number }) | null> {
    const entry = this.auctions.get(auctionId);
    if (entry) {
      const state = entry.engine.getState() as AuctionState;
      const withEndTime = { ...state } as AuctionState & {
        itemEndTime?: number;
      };
      if (entry.itemEndTimeMs != null) {
        withEndTime.itemEndTime = entry.itemEndTimeMs;
      }
      return withEndTime;
    }

    // Fallback to DB for ended/historical auctions
    return this.persistence.loadAuction(auctionId);
  }

  /** Start auction: engine transition, seed Redis, persist, schedule timer */
  async startAuction(
    auctionId: string,
  ): Promise<{ started: boolean; reason?: string }> {
    const entry = this.auctions.get(auctionId);
    if (!entry) return { started: false, reason: 'Auction not found' };

    const result = entry.engine.startAuction();
    if (!result.started) return result;

    const state = entry.engine.getState() as AuctionState;
    const firstItem = state.items[0];

    // Seed Redis for first item
    if (firstItem) {
      await this.redis.seedItem(
        auctionId,
        firstItem.id,
        firstItem.startingPrice,
      );
    }

    // Persist status change to DB
    await this.persistence.persistAuctionStatus(auctionId, 'LIVE', {
      startedAt: new Date(),
    });
    if (firstItem) {
      await this.persistence.persistItemStatus(firstItem.id, 'LIVE');
    }

    this.scheduleItemExpiry(auctionId);
    this.emitState(auctionId);
    return result;
  }

  /**
   * Place bid: engine validates, Redis atomic check, persist to DB.
   * Redis is the arbiter for concurrent bids. Engine is updated after Redis accepts.
   */
  async placeBid(
    auctionId: string,
    userId: string,
    amount: number,
    idempotencyKey?: string,
  ): Promise<{ accepted: boolean; reason?: string }> {
    return this.withAuctionLock(auctionId, async () => {
      const entry = this.auctions.get(auctionId);
      if (!entry) return { accepted: false, reason: 'Auction not found' };

      // Engine validates business rules (auction LIVE, item LIVE, bid > current)
      const state = entry.engine.getState() as AuctionState;
      if (state.status !== 'LIVE') {
        return {
          accepted: false,
          reason: `Auction is not live (status: ${state.status})`,
        };
      }
      const currentItem = state.items[state.currentItemIndex];
      if (!currentItem || currentItem.status !== 'LIVE') {
        return { accepted: false, reason: 'No item currently being auctioned' };
      }

      const normalizedIdempotencyKey =
        idempotencyKey?.trim().slice(0, 128) || null;
      if (normalizedIdempotencyKey) {
        const existing = await this.redis.getBidIdempotencyResult(
          auctionId,
          currentItem.id,
          userId,
          normalizedIdempotencyKey,
        );
        if (existing) return existing;

        const claimed = await this.redis.claimBidIdempotency(
          auctionId,
          currentItem.id,
          userId,
          normalizedIdempotencyKey,
        );
        if (!claimed) {
          const settled = await this.waitForBidIdempotencyResult(
            auctionId,
            currentItem.id,
            userId,
            normalizedIdempotencyKey,
          );
          return (
            settled ?? { accepted: false, reason: 'Duplicate bid in progress' }
          );
        }
      }

      const finalize = async (result: BidOutcome): Promise<BidOutcome> => {
        if (!normalizedIdempotencyKey) return result;
        await this.redis.storeBidIdempotencyResult(
          auctionId,
          currentItem.id,
          userId,
          normalizedIdempotencyKey,
          result,
        );
        return result;
      };

      if (amount <= currentItem.highestBid) {
        return finalize({
          accepted: false,
          reason: `Bid must be higher than current highest (${currentItem.highestBid})`,
        });
      }

      // Redis atomic check-and-set (the real concurrency guard)
      const accepted = await this.redis.atomicBidCheck(
        auctionId,
        currentItem.id,
        amount,
        userId,
      );
      if (!accepted) {
        return finalize({
          accepted: false,
          reason: 'Bid was outpaced by another bidder',
        });
      }

      // Redis accepted -> update in-memory engine
      entry.engine.placeBid(userId, amount);

      // Persist bid + item state in DB
      await this.persistence
        .persistBid(auctionId, currentItem.id, userId, amount)
        .catch((err) =>
          this.logger.error(`Failed to persist bid: ${err.message}`, err.stack),
        );

      this.emitState(auctionId);
      return finalize({ accepted: true });
    });
  }

  /** Extend current item timer */
  async extendItem(
    auctionId: string,
    sellerId: string,
  ): Promise<{ extended: boolean; reason?: string }> {
    const entry = this.auctions.get(auctionId);
    if (!entry) return { extended: false, reason: 'Auction not found' };

    const state = entry.engine.getState();
    if (state.sellerId !== sellerId) {
      return { extended: false, reason: 'Not the seller' };
    }

    const result = entry.engine.extendCurrentItem();
    if (!result.extended) return result;

    // Persist extension to DB
    const currentItem = state.items[state.currentItemIndex];
    if (currentItem) {
      this.persistence
        .persistItemExtension(currentItem.id)
        .catch((err) =>
          this.logger.error(
            `Failed to persist item extension: ${err.message}`,
            err.stack,
          ),
        );
    }

    this.scheduleItemExpiry(auctionId);
    this.emitState(auctionId);
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  TIMER LOGIC                                                        */
  /* ------------------------------------------------------------------ */

  private scheduleItemExpiry(auctionId: string): void {
    const entry = this.auctions.get(auctionId);
    if (!entry) return;
    const hadActiveTimer = entry.itemTimer != null;
    const previousEndTimeMs = entry.itemEndTimeMs;
    if (entry.itemTimer) {
      clearTimeout(entry.itemTimer);
      entry.itemTimer = null;
    }
    const state = entry.engine.getState();
    if (state.status !== 'LIVE') return;
    const item = state.items[state.currentItemIndex];
    if (!item || item.status !== 'LIVE') return;
    const now = Date.now();
    const baseDurationMs = item.durationSec * 1000;
    const extensionMs = item.extended ? item.extraDurationSec * 1000 : 0;

    // When extending an already-running timer, add extra time to remaining
    // time rather than resetting the full item duration from "now".
    const durationMs =
      hadActiveTimer && previousEndTimeMs != null && item.extended
        ? Math.max(0, previousEndTimeMs - now) + item.extraDurationSec * 1000
        : baseDurationMs + extensionMs;
    const endTimeMs = now + durationMs;
    entry.itemEndTimeMs = endTimeMs;
    entry.itemTimer = setTimeout(
      () => this.onItemTimerExpired(auctionId),
      durationMs,
    );
  }

  private async onItemTimerExpired(auctionId: string): Promise<void> {
    await this.withAuctionLock(auctionId, async () => {
      const entry = this.auctions.get(auctionId);
      if (!entry) return;
      entry.itemTimer = null;
      entry.itemEndTimeMs = null;

      const endResult = entry.engine.endCurrentItem();
      if (!endResult.ended) return;
      const state = entry.engine.getState() as AuctionState;

      // Persist item result to DB
      await this.persistence
        .persistItemResult(
          endResult.itemId,
          endResult.winnerId,
          endResult.finalPrice,
        )
        .catch((err) =>
          this.logger.error(
            `Failed to persist item result: ${err.message}`,
            err.stack,
          ),
        );

      // Clear Redis keys for sold item
      await this.redis.clearItem(auctionId, endResult.itemId);

      this.eventEmitter.emit('stateChange', {
        event: 'item_sold',
        auctionId,
        itemId: endResult.itemId,
        winnerId: endResult.winnerId,
        finalPrice: endResult.finalPrice,
        sold: endResult.hadBids,
        state,
      } satisfies AuctionStateChangeEvent);

      const advanceResult =
        entry.engine.advanceToNextItem() as AdvanceToNextItemResult;
      if (!advanceResult.advanced) return;
      const stateAfter = entry.engine.getState() as AuctionState;

      if (stateAfter.status === 'ENDED') {
        const endAuctionResult = entry.engine.endAuction();
        if (endAuctionResult.ended) {
          // Persist auction end to DB
          await this.persistence
            .persistAuctionEnd(auctionId, endAuctionResult.results)
            .catch((err) =>
              this.logger.error(
                `Failed to persist auction end: ${err.message}`,
                err.stack,
              ),
            );

          // Clear all Redis keys for this auction
          const itemIds = stateAfter.items.map((i) => i.id);
          await this.redis.clearAuction(auctionId, itemIds);

          this.eventEmitter.emit('stateChange', {
            event: 'auction_ended',
            auctionId,
            results: endAuctionResult.results,
            state: stateAfter,
          } satisfies AuctionStateChangeEvent);
        }
        // Remove from in-memory map (DB is source of truth for ended auctions)
        this.auctions.delete(auctionId);
        return;
      }

      // Next item: seed Redis, persist, schedule timer
      const nextItem = stateAfter.items[stateAfter.currentItemIndex];
      if (nextItem) {
        await this.redis.seedItem(
          auctionId,
          nextItem.id,
          nextItem.startingPrice,
        );
        await this.persistence
          .persistItemStatus(nextItem.id, 'LIVE')
          .catch((err) =>
            this.logger.error(
              `Failed to persist next item status: ${err.message}`,
              err.stack,
            ),
          );
        await this.persistence
          .persistCurrentItemIndex(auctionId, stateAfter.currentItemIndex)
          .catch((err) =>
            this.logger.error(
              `Failed to persist currentItemIndex: ${err.message}`,
              err.stack,
            ),
          );
      }

      this.scheduleItemExpiry(auctionId);
      this.emitState(auctionId);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  INTERNAL                                                           */
  /* ------------------------------------------------------------------ */

  private emitState(auctionId: string): void {
    const entry = this.auctions.get(auctionId);
    if (!entry) return;
    const state = entry.engine.getState() as AuctionState;
    const withEndTime = { ...state } as AuctionState & {
      itemEndTime?: number;
    };
    if (entry.itemEndTimeMs != null) {
      withEndTime.itemEndTime = entry.itemEndTimeMs;
    }
    this.eventEmitter.emit('stateChange', {
      event: 'auction_state',
      auctionId,
      state: withEndTime,
    } satisfies AuctionStateChangeEvent);
  }

  private async waitForBidIdempotencyResult(
    auctionId: string,
    itemId: string,
    bidderId: string,
    idempotencyKey: string,
  ): Promise<BidOutcome | null> {
    const maxAttempts = 40;
    for (let i = 0; i < maxAttempts; i += 1) {
      const result = await this.redis.getBidIdempotencyResult(
        auctionId,
        itemId,
        bidderId,
        idempotencyKey,
      );
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  private async withAuctionLock<T>(
    auctionId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.auctionLocks.get(auctionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.auctionLocks.set(
      auctionId,
      prev.then(() => current),
    );

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.auctionLocks.get(auctionId) === current) {
        this.auctionLocks.delete(auctionId);
      }
    }
  }
}
