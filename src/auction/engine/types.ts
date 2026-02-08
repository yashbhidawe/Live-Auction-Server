/**
 * Auction state machine: CREATED → LIVE → ENDED
 */
export type AuctionStatus = 'CREATED' | 'LIVE' | 'ENDED';

/**
 * Single source of truth for one auction. All engine logic reads/writes this shape.
 */
export interface AuctionState {
  status: AuctionStatus;
  startingPrice: number;
  highestBid: number;
  highestBidderId: string | null;
}

/**
 * Result of placeBid() – explicit accepted/rejected with reason.
 */
export type PlaceBidResult =
  | { accepted: true }
  | { accepted: false; reason: string };

/**
 * Result of endAuction() – explicit ended + optional winner info.
 */
export type EndAuctionResult =
  | { ended: true; winnerId: string | null; finalPrice: number }
  | { ended: false; reason: string };

/**
 * Result of startAuction() – explicit started or reason.
 */
export type StartAuctionResult =
  | { started: true }
  | { started: false; reason: string };
