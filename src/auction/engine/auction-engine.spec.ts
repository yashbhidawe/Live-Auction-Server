import { AuctionEngine } from './auction-engine';

describe('AuctionEngine (isolated)', () => {
  let engine: AuctionEngine;

  beforeEach(() => {
    engine = new AuctionEngine();
  });

  describe('state machine', () => {
    it('starts in CREATED', () => {
      expect(engine.getState().status).toBe('CREATED');
    });

    it('startAuction() transitions CREATED → LIVE', () => {
      const result = engine.startAuction(100);
      expect(result).toEqual({ started: true });
      expect(engine.getState().status).toBe('LIVE');
      expect(engine.getState().startingPrice).toBe(100);
      expect(engine.getState().highestBid).toBe(100);
    });

    it('rejects startAuction when not CREATED', () => {
      engine.startAuction(50);
      expect(engine.startAuction(200)).toEqual({
        started: false,
        reason: 'Auction cannot start from status LIVE',
      });
    });

    it('endAuction() transitions LIVE → ENDED', () => {
      engine.startAuction(100);
      engine.placeBid('user1', 150);
      const result = engine.endAuction();
      expect(result).toEqual({
        ended: true,
        winnerId: 'user1',
        finalPrice: 150,
      });
      expect(engine.getState().status).toBe('ENDED');
    });

    it('rejects endAuction when not LIVE', () => {
      expect(engine.endAuction()).toEqual({
        ended: false,
        reason: 'Auction cannot end from status CREATED',
      });
    });
  });

  describe('placeBid', () => {
    it('rejects when auction not LIVE', () => {
      expect(engine.placeBid('user1', 100)).toEqual({
        accepted: false,
        reason: 'Auction is not live (status: CREATED)',
      });
    });

    it('rejects bid <= current highest', () => {
      engine.startAuction(100);
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
      engine.startAuction(100);
      expect(engine.placeBid('user1', 150)).toEqual({ accepted: true });
      expect(engine.getState().highestBid).toBe(150);
      expect(engine.getState().highestBidderId).toBe('user1');
    });

    it('deterministic: same state + same bid gives same result', () => {
      engine.startAuction(100);
      const r1 = engine.placeBid('alice', 150);
      const engine2 = new AuctionEngine();
      engine2.startAuction(100);
      const r2 = engine2.placeBid('alice', 150);
      expect(r1).toEqual(r2);
      expect(r1).toEqual({ accepted: true });
    });
  });

  describe('getState idempotent', () => {
    it('returns copy so caller cannot mutate internal state', () => {
      engine.startAuction(100);
      const a = engine.getState();
      const b = engine.getState();
      expect(a).toEqual(b);
      (a as { highestBid: number }).highestBid = 999;
      expect(engine.getState().highestBid).toBe(100);
    });
  });

  describe('setState (replaceable storage)', () => {
    it('restores state from external storage', () => {
      engine.setState({
        status: 'LIVE',
        startingPrice: 50,
        highestBid: 75,
        highestBidderId: 'bob',
      });
      expect(engine.getState().highestBidderId).toBe('bob');
      expect(engine.placeBid('alice', 100)).toEqual({ accepted: true });
    });
  });
});
