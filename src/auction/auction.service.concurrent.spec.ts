import { AuctionService } from './auction.service';

type BidOutcome = { accepted: boolean; reason?: string };

class RedisTestDouble {
  private readonly highestBid = new Map<string, number>();
  private readonly highestBidder = new Map<string, string>();
  private readonly idemPending = new Set<string>();
  private readonly idemResult = new Map<string, BidOutcome>();

  private itemScope(auctionId: string, itemId: string): string {
    return `${auctionId}:${itemId}`;
  }

  private idemScope(
    auctionId: string,
    itemId: string,
    bidderId: string,
    idempotencyKey: string,
  ): string {
    return `${auctionId}:${itemId}:${bidderId}:${idempotencyKey}`;
  }

  async seedItem(
    auctionId: string,
    itemId: string,
    startingPrice: number,
  ): Promise<void> {
    const scope = this.itemScope(auctionId, itemId);
    this.highestBid.set(scope, startingPrice);
    this.highestBidder.delete(scope);
  }

  async atomicBidCheck(
    auctionId: string,
    itemId: string,
    newBid: number,
    bidderId: string,
  ): Promise<boolean> {
    const scope = this.itemScope(auctionId, itemId);
    const current = this.highestBid.get(scope);
    if (current == null || newBid > current) {
      this.highestBid.set(scope, newBid);
      this.highestBidder.set(scope, bidderId);
      return true;
    }
    return false;
  }

  async claimBidIdempotency(
    auctionId: string,
    itemId: string,
    bidderId: string,
    idempotencyKey: string,
  ): Promise<boolean> {
    const scope = this.idemScope(auctionId, itemId, bidderId, idempotencyKey);
    if (this.idemPending.has(scope) || this.idemResult.has(scope)) return false;
    this.idemPending.add(scope);
    return true;
  }

  async getBidIdempotencyResult(
    auctionId: string,
    itemId: string,
    bidderId: string,
    idempotencyKey: string,
  ): Promise<BidOutcome | null> {
    const scope = this.idemScope(auctionId, itemId, bidderId, idempotencyKey);
    return this.idemResult.get(scope) ?? null;
  }

  async storeBidIdempotencyResult(
    auctionId: string,
    itemId: string,
    bidderId: string,
    idempotencyKey: string,
    result: BidOutcome,
  ): Promise<void> {
    const scope = this.idemScope(auctionId, itemId, bidderId, idempotencyKey);
    this.idemPending.delete(scope);
    this.idemResult.set(scope, result);
  }

  async clearItem(auctionId: string, itemId: string): Promise<void> {
    const scope = this.itemScope(auctionId, itemId);
    this.highestBid.delete(scope);
    this.highestBidder.delete(scope);
  }

  async clearAuction(_auctionId: string, _itemIds: string[]): Promise<void> {}
}

describe('AuctionService backend correctness hardening', () => {
  let service: AuctionService;
  let redis: RedisTestDouble;
  const persistence = {
    validateSellerExists: jest.fn(async () => true),
    persistAuction: jest.fn(async () => {}),
    persistAuctionStatus: jest.fn(async () => {}),
    persistItemStatus: jest.fn(async () => {}),
    persistBid: jest.fn(async () => {}),
    persistItemResult: jest.fn(async () => {}),
    persistAuctionEnd: jest.fn(async () => {}),
    persistItemExtension: jest.fn(async () => {}),
    persistCurrentItemIndex: jest.fn(async () => {}),
    loadActiveAuctions: jest.fn(async () => []),
    listAuctions: jest.fn(async () => []),
    loadAuction: jest.fn(async () => null),
  };

  beforeEach(() => {
    redis = new RedisTestDouble();
    jest.clearAllMocks();
    service = new AuctionService(redis as never, persistence as never);
  });

  async function createAndStartAuction() {
    const created = await service.createAuction({
      sellerId: 'seller-1',
      items: [{ name: 'Item A', startingPrice: 100, durationSec: 60 }],
    });
    if ('error' in created) throw new Error(created.error);
    const started = await service.startAuction(created.id);
    expect(started.started).toBe(true);
    return created.id;
  }

  it('handles 20+ simultaneous bids and final highest bid is source of truth', async () => {
    const auctionId = await createAndStartAuction();

    const bids = Array.from({ length: 25 }, (_, i) => ({
      userId: `user-${i + 1}`,
      amount: 101 + i,
    }));

    const results = await Promise.all(
      bids.map((b) => service.placeBid(auctionId, b.userId, b.amount)),
    );

    const acceptedBids = bids.filter((_, idx) => results[idx]?.accepted);
    expect(acceptedBids.length).toBeGreaterThan(0);

    const state = await service.getState(auctionId);
    expect(state).not.toBeNull();
    const current = state!.items[state!.currentItemIndex]!;
    const highestAccepted = Math.max(...acceptedBids.map((b) => b.amount));

    expect(current.highestBid).toBe(highestAccepted);
    expect(acceptedBids.some((b) => b.userId === current.highestBidderId)).toBe(
      true,
    );
    expect(persistence.persistBid).toHaveBeenCalledTimes(acceptedBids.length);
  });

  it('preserves ordering correctness: lower bid after higher bid is rejected', async () => {
    const auctionId = await createAndStartAuction();

    const r1 = await service.placeBid(auctionId, 'alice', 150);
    const r2 = await service.placeBid(auctionId, 'bob', 140);
    const r3 = await service.placeBid(auctionId, 'charlie', 160);

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(false);
    expect(r3.accepted).toBe(true);

    const state = await service.getState(auctionId);
    expect(state?.items[0]?.highestBid).toBe(160);
    expect(state?.items[0]?.highestBidderId).toBe('charlie');
  });

  it('deduplicates retries via idempotency key (no duplicate persistence)', async () => {
    const auctionId = await createAndStartAuction();

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.placeBid(auctionId, 'retry-user', 175, 'idem-key-1'),
      ),
    );

    expect(results[0]).toEqual({ accepted: true });
    for (const result of results) {
      expect(result).toEqual({ accepted: true });
    }
    expect(persistence.persistBid).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate same-amount concurrent bids (no lost/duplicate writes)', async () => {
    const auctionId = await createAndStartAuction();

    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        service.placeBid(auctionId, `same-${i}`, 130),
      ),
    );

    const acceptedCount = results.filter((r) => r.accepted).length;
    expect(acceptedCount).toBe(1);
    expect(persistence.persistBid).toHaveBeenCalledTimes(1);

    const state = await service.getState(auctionId);
    expect(state?.items[0]?.highestBid).toBe(130);
  });

  it('extends from remaining time instead of resetting full duration', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const auctionId = await createAndStartAuction();

      const before = await service.getState(auctionId);
      expect(before?.itemEndTime).toBeDefined();
      const beforeEndTime = before?.itemEndTime as number;

      // 45s elapsed on a 60s timer => 15s remaining.
      jest.setSystemTime(new Date(Date.now() + 45_000));

      const extend = await service.extendItem(auctionId, 'seller-1');
      expect(extend.extended).toBe(true);

      const after = await service.getState(auctionId);
      expect(after?.itemEndTime).toBe(beforeEndTime + 15_000);
      expect((after!.itemEndTime! - Date.now()) / 1000).toBe(30);
    } finally {
      jest.useRealTimers();
    }
  });
});
