import type {
  AuctionState,
  AuctionItem,
  CreateAuctionInput,
  CreateAuctionResult,
  StartAuctionResult,
  PlaceBidResult,
  EndCurrentItemResult,
  AdvanceToNextItemResult,
  ExtendCurrentItemResult,
  EndAuctionResult,
} from './types';

const DEFAULT_ITEM_DURATION_SEC = 60;
const DEFAULT_EXTRA_DURATION_SEC = 15;
const DEFAULT_MAX_AUCTION_DURATION_SEC = 300;

function generateItemId(auctionId: string, index: number): string {
  return `${auctionId}-item-${index}`;
}

/**
 * Pure auction engine: backend-authoritative, deterministic, no side effects.
 * Manages one auction with a list of items; timer logic lives in the service layer.
 */
export class AuctionEngine {
  private state: AuctionState;

  constructor(auctionId: string, input: CreateAuctionInput) {
    const items: AuctionItem[] = input.items.map((item, index) => ({
      id: generateItemId(auctionId, index),
      name: item.name,
      startingPrice: item.startingPrice,
      durationSec: item.durationSec ?? DEFAULT_ITEM_DURATION_SEC,
      extraDurationSec: DEFAULT_EXTRA_DURATION_SEC,
      status: 'PENDING' as const,
      highestBid: item.startingPrice,
      highestBidderId: null,
      extended: false,
    }));

    this.state = {
      id: auctionId,
      sellerId: input.sellerId,
      status: 'CREATED',
      items,
      currentItemIndex: 0,
      maxDurationSec: DEFAULT_MAX_AUCTION_DURATION_SEC,
    };
  }

  /**
   * Transition CREATED → LIVE; first item goes LIVE.
   */
  startAuction(): StartAuctionResult {
    if (this.state.status !== 'CREATED') {
      return {
        started: false,
        reason: `Auction cannot start from status ${this.state.status}`,
      };
    }
    if (this.state.items.length === 0) {
      return { started: false, reason: 'Auction has no items' };
    }
    this.state.status = 'LIVE';
    this.state.items[0]!.status = 'LIVE';
    this.state.items[0]!.highestBid = this.state.items[0]!.startingPrice;
    return { started: true };
  }

  /**
   * Place a bid on the current LIVE item.
   */
  placeBid(userId: string, amount: number): PlaceBidResult {
    if (this.state.status !== 'LIVE') {
      return {
        accepted: false,
        reason: `Auction is not live (status: ${this.state.status})`,
      };
    }
    const item = this.getCurrentItem();
    if (!item || item.status !== 'LIVE') {
      return { accepted: false, reason: 'No item currently being auctioned' };
    }
    if (amount <= item.highestBid) {
      return {
        accepted: false,
        reason: `Bid must be higher than current highest (${item.highestBid})`,
      };
    }
    item.highestBid = amount;
    item.highestBidderId = userId;
    return { accepted: true };
  }

  /**
   * End the current item (mark SOLD or UNSOLD). Caller must then advance.
   */
  endCurrentItem(): EndCurrentItemResult {
    if (this.state.status !== 'LIVE') {
      return {
        ended: false,
        reason: `Auction is not live (status: ${this.state.status})`,
      };
    }
    const item = this.getCurrentItem();
    if (!item || item.status !== 'LIVE') {
      return { ended: false, reason: 'No item currently live' };
    }
    const hadBids =
      item.highestBidderId !== null && item.highestBid > item.startingPrice;
    item.status = hadBids ? 'SOLD' : 'UNSOLD';
    return {
      ended: true,
      itemId: item.id,
      winnerId: item.highestBidderId,
      finalPrice: item.highestBid,
      hadBids,
    };
  }

  /**
   * Move to next item (next goes LIVE) or end auction if none left.
   */
  advanceToNextItem(): AdvanceToNextItemResult {
    if (this.state.status !== 'LIVE') {
      return {
        advanced: false,
        reason: `Auction is not live (status: ${this.state.status})`,
      };
    }
    const nextIndex = this.state.currentItemIndex + 1;
    if (nextIndex >= this.state.items.length) {
      this.state.status = 'ENDED';
      return { advanced: true, nextItemLive: false };
    }
    this.state.currentItemIndex = nextIndex;
    const next = this.state.items[nextIndex]!;
    next.status = 'LIVE';
    next.highestBid = next.startingPrice;
    return { advanced: true, nextItemLive: true };
  }

  /**
   * Add extra time to current item (once per item).
   */
  extendCurrentItem(): ExtendCurrentItemResult {
    if (this.state.status !== 'LIVE') {
      return {
        extended: false,
        reason: `Auction is not live (status: ${this.state.status})`,
      };
    }
    const item = this.getCurrentItem();
    if (!item || item.status !== 'LIVE') {
      return { extended: false, reason: 'No item currently live' };
    }
    if (item.extended) {
      return { extended: false, reason: 'Item already extended' };
    }
    item.extended = true;
    return { extended: true };
  }

  /**
   * Full auction end (e.g. manual). Returns summary of all items.
   */
  endAuction(): EndAuctionResult {
    if (this.state.status === 'ENDED') {
      return {
        ended: true,
        results: this.state.items.map((i) => ({
          itemId: i.id,
          winnerId: i.highestBidderId,
          finalPrice: i.highestBid,
        })),
      };
    }
    this.state.status = 'ENDED';
    const results = this.state.items.map((i) => ({
      itemId: i.id,
      winnerId: i.status === 'SOLD' ? i.highestBidderId : null,
      finalPrice: i.highestBid,
    }));
    return { ended: true, results };
  }

  getState(): Readonly<AuctionState> {
    return JSON.parse(JSON.stringify(this.state)) as AuctionState;
  }

  setState(state: AuctionState): void {
    this.state = JSON.parse(JSON.stringify(state)) as AuctionState;
  }

  private getCurrentItem(): AuctionItem | null {
    const idx = this.state.currentItemIndex;
    return this.state.items[idx] ?? null;
  }
}
