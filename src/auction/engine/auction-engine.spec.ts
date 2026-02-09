import { AuctionEngine } from './auction-engine';

const createInput = () => ({
  sellerId: 'seller-1',
  items: [
    { name: 'Item A', startingPrice: 100 },
    { name: 'Item B', startingPrice: 50 },
  ],
});

describe('AuctionEngine (isolated)', () => {
  let engine: AuctionEngine;

  beforeEach(() => {
    engine = new AuctionEngine('auction-1', createInput());
  });

  describe('creation and state machine', () => {
    it('starts in CREATED with items PENDING', () => {
      const state = engine.getState();
      expect(state.status).toBe('CREATED');
      expect(state.id).toBe('auction-1');
      expect(state.sellerId).toBe('seller-1');
      expect(state.items).toHaveLength(2);
      expect(state.items[0]?.status).toBe('PENDING');
      expect(state.items[1]?.status).toBe('PENDING');
      expect(state.currentItemIndex).toBe(0);
    });

    it('startAuction() transitions CREATED → LIVE, first item LIVE', () => {
      const result = engine.startAuction();
      expect(result).toEqual({ started: true });
      const state = engine.getState();
      expect(state.status).toBe('LIVE');
      expect(state.items[0]?.status).toBe('LIVE');
      expect(state.items[0]?.highestBid).toBe(100);
    });

    it('rejects startAuction when not CREATED', () => {
      engine.startAuction();
      expect(engine.startAuction()).toEqual({
        started: false,
        reason: 'Auction cannot start from status LIVE',
      });
    });

    it('rejects startAuction when no items', () => {
      const empty = new AuctionEngine('e1', { sellerId: 's', items: [] });
      expect(empty.startAuction()).toEqual({
        started: false,
        reason: 'Auction has no items',
      });
    });
  });

  describe('placeBid', () => {
    beforeEach(() => engine.startAuction());

    it('rejects when auction not LIVE', () => {
      const eng = new AuctionEngine('x', createInput());
      expect(eng.placeBid('user1', 100)).toEqual({
        accepted: false,
        reason: 'Auction is not live (status: CREATED)',
      });
    });

    it('rejects bid <= current highest', () => {
      expect(engine.placeBid('user1', 99)).toEqual({
        accepted: false,
        reason: 'Bid must be higher than current highest (100)',
      });
      expect(engine.placeBid('user1', 100)).toEqual({
        accepted: false,
        reason: 'Bid must be higher than current highest (100)',
      });
    });

    it('accepts bid > current highest', () => {
      expect(engine.placeBid('user1', 150)).toEqual({ accepted: true });
      const state = engine.getState();
      expect(state.items[0]?.highestBid).toBe(150);
      expect(state.items[0]?.highestBidderId).toBe('user1');
    });
  });

  describe('endCurrentItem and advanceToNextItem', () => {
    beforeEach(() => engine.startAuction());

    it('endCurrentItem marks item SOLD when had bids', () => {
      engine.placeBid('user1', 120);
      const result = engine.endCurrentItem();
      expect(result.ended).toBe(true);
      expect(result.itemId).toBe('auction-1-item-0');
      expect(result.winnerId).toBe('user1');
      expect(result.finalPrice).toBe(120);
      expect(result.hadBids).toBe(true);
      const state = engine.getState();
      expect(state.items[0]?.status).toBe('SOLD');
    });

    it('endCurrentItem marks item UNSOLD when no bids above starting', () => {
      const result = engine.endCurrentItem();
      expect(result.ended).toBe(true);
      expect(result.winnerId).toBe(null);
      expect(result.hadBids).toBe(false);
      const state = engine.getState();
      expect(state.items[0]?.status).toBe('UNSOLD');
    });

    it('advanceToNextItem moves to next item and sets LIVE', () => {
      engine.endCurrentItem();
      const adv = engine.advanceToNextItem();
      expect(adv).toEqual({ advanced: true, nextItemLive: true });
      const state = engine.getState();
      expect(state.currentItemIndex).toBe(1);
      expect(state.items[1]?.status).toBe('LIVE');
      expect(state.items[1]?.highestBid).toBe(50);
    });

    it('advanceToNextItem when no more items ends auction', () => {
      engine.endCurrentItem();
      engine.advanceToNextItem();
      engine.endCurrentItem();
      const adv = engine.advanceToNextItem();
      expect(adv).toEqual({ advanced: true, nextItemLive: false });
      expect(engine.getState().status).toBe('ENDED');
    });
  });

  describe('extendCurrentItem', () => {
    beforeEach(() => engine.startAuction());

    it('extends once per item', () => {
      expect(engine.extendCurrentItem()).toEqual({ extended: true });
      expect(engine.extendCurrentItem()).toEqual({
        extended: false,
        reason: 'Item already extended',
      });
    });

    it('rejects when not LIVE', () => {
      const eng = new AuctionEngine('x', createInput());
      expect(eng.extendCurrentItem()).toEqual({
        extended: false,
        reason: 'Auction is not live (status: CREATED)',
      });
    });
  });

  describe('endAuction', () => {
    it('returns results for all items when called in LIVE', () => {
      engine.startAuction();
      engine.placeBid('user1', 110);
      engine.endCurrentItem();
      engine.advanceToNextItem();
      const result = engine.endAuction();
      expect(result.ended).toBe(true);
      expect(result.results).toHaveLength(2);
    });

    it('idempotent when already ENDED', () => {
      engine.startAuction();
      engine.endAuction();
      const result = engine.endAuction();
      expect(result.ended).toBe(true);
      expect(result.results).toBeDefined();
    });
  });

  describe('full lifecycle', () => {
    it('create → start → bid → end item → advance → end item → advance → ENDED', () => {
      expect(engine.getState().status).toBe('CREATED');
      engine.startAuction();
      expect(engine.getState().status).toBe('LIVE');
      engine.placeBid('alice', 150);
      const end1 = engine.endCurrentItem();
      expect(end1.ended).toBe(true);
      expect(end1.winnerId).toBe('alice');
      engine.advanceToNextItem();
      engine.placeBid('bob', 60);
      engine.endCurrentItem();
      const adv = engine.advanceToNextItem();
      expect(adv.nextItemLive).toBe(false);
      expect(engine.getState().status).toBe('ENDED');
    });
  });

  describe('getState idempotent', () => {
    it('returns copy so caller cannot mutate internal state', () => {
      engine.startAuction();
      const a = engine.getState();
      const b = engine.getState();
      expect(a).toEqual(b);
      (a.items[0] as { highestBid: number }).highestBid = 999;
      expect(engine.getState().items[0]?.highestBid).toBe(100);
    });
  });

  describe('setState (replaceable storage)', () => {
    it('restores state from external storage', () => {
      engine.startAuction();
      const state = engine.getState();
      const engine2 = new AuctionEngine('auction-1', createInput());
      engine2.setState(state);
      expect(engine2.placeBid('alice', 200)).toEqual({ accepted: true });
      expect(engine2.getState().items[0]?.highestBid).toBe(200);
    });
  });
});
