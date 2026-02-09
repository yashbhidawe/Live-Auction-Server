/**
 * Item-level state: PENDING → LIVE → SOLD | UNSOLD
 */
export type ItemStatus = 'PENDING' | 'LIVE' | 'SOLD' | 'UNSOLD';

/**
 * Single item in an auction.
 */
export interface AuctionItem {
  id: string;
  name: string;
  startingPrice: number;
  durationSec: number;
  extraDurationSec: number;
  status: ItemStatus;
  highestBid: number;
  highestBidderId: string | null;
  extended: boolean;
}

/**
 * Auction state machine: CREATED → LIVE → ENDED
 */
export type AuctionStatus = 'CREATED' | 'LIVE' | 'ENDED';

/**
 * Single source of truth for one auction. All engine logic reads/writes this shape.
 */
export interface AuctionState {
  id: string;
  sellerId: string;
  status: AuctionStatus;
  items: AuctionItem[];
  currentItemIndex: number;
  maxDurationSec: number;
}

/**
 * Input to create an auction (item list without ids/state).
 */
export interface CreateAuctionItemInput {
  name: string;
  startingPrice: number;
  durationSec?: number;
}

export interface CreateAuctionInput {
  sellerId: string;
  items: CreateAuctionItemInput[];
}

/**
 * Result of createAuction() – returns full state.
 */
export type CreateAuctionResult =
  | { created: true; state: AuctionState }
  | { created: false; reason: string };

/**
 * Result of startAuction() – explicit started or reason.
 */
export type StartAuctionResult =
  | { started: true }
  | { started: false; reason: string };

/**
 * Result of placeBid() – explicit accepted/rejected with reason.
 */
export type PlaceBidResult =
  | { accepted: true }
  | { accepted: false; reason: string };

/**
 * Result of endCurrentItem() – winner info for current item.
 */
export type EndCurrentItemResult =
  | {
      ended: true;
      itemId: string;
      winnerId: string | null;
      finalPrice: number;
      hadBids: boolean;
    }
  | { ended: false; reason: string };

/**
 * Result of advanceToNextItem() – whether there is a next item or auction ended.
 */
export type AdvanceToNextItemResult =
  | { advanced: true; nextItemLive: boolean }
  | { advanced: false; reason: string };

/**
 * Result of extendCurrentItem() – whether extended.
 */
export type ExtendCurrentItemResult =
  | { extended: true }
  | { extended: false; reason: string };

/**
 * Result of endAuction() – explicit ended + summary.
 */
export type EndAuctionResult =
  | {
      ended: true;
      results: Array<{
        itemId: string;
        winnerId: string | null;
        finalPrice: number;
      }>;
    }
  | { ended: false; reason: string };
