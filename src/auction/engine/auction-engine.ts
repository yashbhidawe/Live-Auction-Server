import type {
  AuctionState,
  PlaceBidResult,
  EndAuctionResult,
  StartAuctionResult,
} from './types';

/**
 * Pure auction engine: backend-authoritative, deterministic, no side effects.
 * Single in-memory state; storage (e.g. Redis) is applied outside by the caller.
 * No framework dependencies – testable in isolation.
 */
export class AuctionEngine {
  private state: AuctionState;

  constructor(initialState?: Partial<AuctionState>) {
    this.state = {
      status: 'CREATED',
      startingPrice: 0,
      highestBid: 0,
      highestBidderId: null,
      ...initialState,
    };
  }

  /**
   * Transition CREATED → LIVE. Sets starting price.
   */
  startAuction(startingPrice: number): StartAuctionResult {
    if (this.state.status !== 'CREATED') {
      return {
        started: false,
        reason: `Auction cannot start from status ${this.state.status}`,
      };
    }
    if (startingPrice < 0) {
      return { started: false, reason: 'Starting price must be non-negative' };
    }
    this.state.status = 'LIVE';
    this.state.startingPrice = startingPrice;
    this.state.highestBid = startingPrice;
    return { started: true };
  }

  /**
   * Place a bid. Only LIVE auctions accept; bid must be > current highest.
   */
  placeBid(userId: string, amount: number): PlaceBidResult {
    if (this.state.status !== 'LIVE') {
      return {
        accepted: false,
        reason: `Auction is not live (status: ${this.state.status})`,
      };
    }
    const currentHighest = this.state.highestBid;
    if (amount <= currentHighest) {
      return {
        accepted: false,
        reason: `Bid must be higher than current highest (${currentHighest})`,
      };
    }
    this.state.highestBid = amount;
    this.state.highestBidderId = userId;
    return { accepted: true };
  }

  /**
   * Transition LIVE → ENDED. Returns winner and final price.
   */
  endAuction(): EndAuctionResult {
    if (this.state.status !== 'LIVE') {
      return {
        ended: false,
        reason: `Auction cannot end from status ${this.state.status}`,
      };
    }
    const winnerId = this.state.highestBidderId;
    const finalPrice = this.state.highestBid;
    this.state.status = 'ENDED';
    return { ended: true, winnerId, finalPrice };
  }

  /**
   * Idempotent read. Returns a shallow copy so callers cannot mutate internal state.
   */
  getState(): Readonly<AuctionState> {
    return { ...this.state };
  }

  /**
   * Replace internal state (e.g. after loading from Redis). Use for replaceable storage.
   */
  setState(state: AuctionState): void {
    this.state = { ...state };
  }
}
