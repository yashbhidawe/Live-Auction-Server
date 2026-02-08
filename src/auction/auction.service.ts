import { Injectable } from '@nestjs/common';
import { AuctionEngine } from './engine';
import type { AuctionState } from './engine';

@Injectable()
export class AuctionService {
  private readonly engine = new AuctionEngine();

  startAuction(startingPrice: number) {
    return this.engine.startAuction(startingPrice);
  }

  placeBid(userId: string, amount: number) {
    return this.engine.placeBid(userId, amount);
  }

  endAuction() {
    return this.engine.endAuction();
  }

  getState() {
    return this.engine.getState();
  }

  /** Restore state from storage (e.g. Redis). Keeps engine logic independent of storage. */
  restoreState(state: AuctionState): void {
    this.engine.setState(state);
  }
}
