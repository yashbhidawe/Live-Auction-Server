import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { AuctionEngine } from './engine';
import type {
  AuctionState,
  CreateAuctionInput,
  AdvanceToNextItemResult,
} from './engine';

const AUCTION_ROOM_PREFIX = 'auction:';

export type AuctionStateChangeEvent =
  | { event: 'auction_state'; auctionId: string; state: AuctionState }
  | {
      event: 'item_sold';
      auctionId: string;
      itemId: string;
      winnerId: string | null;
      finalPrice: number;
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

@Injectable()
export class AuctionService {
  private readonly auctions = new Map<string, AuctionEntry>();
  private readonly eventEmitter = new EventEmitter();

  getEventEmitter(): EventEmitter {
    return this.eventEmitter;
  }

  getRoomName(auctionId: string): string {
    return `${AUCTION_ROOM_PREFIX}${auctionId}`;
  }

  createAuction(input: CreateAuctionInput): AuctionState {
    const id = crypto.randomUUID();
    const engine = new AuctionEngine(id, input);
    this.auctions.set(id, { engine, itemTimer: null, itemEndTimeMs: null });
    return engine.getState() as AuctionState;
  }

  listAuctions(): Array<{ id: string; sellerId: string; status: string }> {
    return Array.from(this.auctions.entries()).map(([id, { engine }]) => {
      const s = engine.getState();
      return { id, sellerId: s.sellerId, status: s.status };
    });
  }

  getState(auctionId: string): AuctionState | null {
    const entry = this.auctions.get(auctionId);
    if (!entry) return null;
    const state = entry.engine.getState() as AuctionState;
    const withEndTime = { ...state } as AuctionState & { itemEndTime?: number };
    if (entry.itemEndTimeMs != null) {
      withEndTime.itemEndTime = entry.itemEndTimeMs;
    }
    return withEndTime as AuctionState;
  }

  startAuction(auctionId: string): { started: boolean; reason?: string } {
    const entry = this.auctions.get(auctionId);
    if (!entry) return { started: false, reason: 'Auction not found' };
    const result = entry.engine.startAuction();
    if (!result.started) return result;
    this.scheduleItemExpiry(auctionId);
    this.emitState(auctionId);
    return result;
  }

  placeBid(
    auctionId: string,
    userId: string,
    amount: number,
  ): { accepted: boolean; reason?: string } {
    const entry = this.auctions.get(auctionId);
    if (!entry) return { accepted: false, reason: 'Auction not found' };
    const result = entry.engine.placeBid(userId, amount);
    if (result.accepted) this.emitState(auctionId);
    return result;
  }

  extendItem(
    auctionId: string,
    sellerId: string,
  ): { extended: boolean; reason?: string } {
    const entry = this.auctions.get(auctionId);
    if (!entry) return { extended: false, reason: 'Auction not found' };
    const state = entry.engine.getState();
    if (state.sellerId !== sellerId)
      return { extended: false, reason: 'Not the seller' };
    const result = entry.engine.extendCurrentItem();
    if (!result.extended) return result;
    this.scheduleItemExpiry(auctionId);
    this.emitState(auctionId);
    return result;
  }

  private scheduleItemExpiry(auctionId: string): void {
    const entry = this.auctions.get(auctionId);
    if (!entry) return;
    if (entry.itemTimer) {
      clearTimeout(entry.itemTimer);
      entry.itemTimer = null;
    }
    const state = entry.engine.getState();
    if (state.status !== 'LIVE') return;
    const item = state.items[state.currentItemIndex];
    if (!item || item.status !== 'LIVE') return;
    const durationMs =
      (item.extended
        ? item.durationSec + item.extraDurationSec
        : item.durationSec) * 1000;
    const endTimeMs = Date.now() + durationMs;
    entry.itemEndTimeMs = endTimeMs;
    entry.itemTimer = setTimeout(
      () => this.onItemTimerExpired(auctionId),
      durationMs,
    );
  }

  private onItemTimerExpired(auctionId: string): void {
    const entry = this.auctions.get(auctionId);
    if (!entry) return;
    entry.itemTimer = null;
    entry.itemEndTimeMs = null;

    const endResult = entry.engine.endCurrentItem();
    if (!endResult.ended) return;
    const state = entry.engine.getState() as AuctionState;
    this.eventEmitter.emit('stateChange', {
      event: 'item_sold',
      auctionId,
      itemId: endResult.itemId,
      winnerId: endResult.winnerId,
      finalPrice: endResult.finalPrice,
      state,
    } satisfies AuctionStateChangeEvent);

    const advanceResult =
      entry.engine.advanceToNextItem() as AdvanceToNextItemResult;
    if (!advanceResult.advanced) return;
    const stateAfter = entry.engine.getState() as AuctionState;

    if (stateAfter.status === 'ENDED') {
      const endAuctionResult = entry.engine.endAuction();
      if (endAuctionResult.ended) {
        this.eventEmitter.emit('stateChange', {
          event: 'auction_ended',
          auctionId,
          results: endAuctionResult.results,
          state: stateAfter,
        } satisfies AuctionStateChangeEvent);
      }
      this.auctions.delete(auctionId);
      return;
    }

    this.scheduleItemExpiry(auctionId);
    this.emitState(auctionId);
  }

  private emitState(auctionId: string): void {
    const entry = this.auctions.get(auctionId);
    if (!entry) return;
    const state = this.getState(auctionId);
    if (state)
      this.eventEmitter.emit('stateChange', {
        event: 'auction_state',
        auctionId,
        state,
      } satisfies AuctionStateChangeEvent);
  }
}
