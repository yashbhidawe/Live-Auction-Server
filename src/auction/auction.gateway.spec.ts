import { Test, TestingModule } from '@nestjs/testing';
import { AuctionGateway } from './auction.gateway';
import { AuctionService } from './auction.service';

describe('AuctionGateway', () => {
  let gateway: AuctionGateway;
  let auctionService: AuctionService;
  let mockServer: { to: jest.Mock; emit: jest.Mock };

  beforeEach(async () => {
    const toMock = jest.fn().mockReturnThis();
    mockServer = { to: toMock, emit: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuctionGateway,
        {
          provide: AuctionService,
          useValue: {
            getRoomName: jest.fn((id: string) => `auction:${id}`),
            getState: jest
              .fn()
              .mockResolvedValue({ id: 'a1', status: 'LIVE', items: [] }),
            getEventEmitter: jest.fn().mockReturnValue({ on: jest.fn() }),
            placeBid: jest.fn().mockResolvedValue({ accepted: true }),
          },
        },
      ],
    }).compile();

    gateway = module.get(AuctionGateway);
    auctionService = module.get(AuctionService);
    (gateway as unknown as { server: typeof mockServer }).server = mockServer;
    gateway.onModuleInit();
  });

  describe('handleJoinAuction', () => {
    it('joins room and emits auction_state to client', async () => {
      const state = { id: 'a1', status: 'LIVE', items: [] };
      jest.mocked(auctionService.getState).mockResolvedValue(state as never);
      const client = { join: jest.fn(), emit: jest.fn() };
      await gateway.handleJoinAuction(client as never, { auctionId: 'a1' });
      expect(client.join).toHaveBeenCalledWith('auction:a1');
      expect(client.emit).toHaveBeenCalledWith('auction_state', state);
    });

    it('emits error when auctionId missing', async () => {
      const client = { join: jest.fn(), emit: jest.fn() };
      await gateway.handleJoinAuction(client as never, {
        auctionId: '',
      });
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'auctionId required',
      });
    });
  });

  describe('handleLeaveAuction', () => {
    it('leaves room when auctionId provided', () => {
      const client = { leave: jest.fn() };
      gateway.handleLeaveAuction(client as never, { auctionId: 'a1' });
      expect(client.leave).toHaveBeenCalledWith('auction:a1');
    });
  });

  describe('handlePlaceBid', () => {
    it('calls service.placeBid with auctionId, userId, amount and emits bid_result', async () => {
      jest
        .mocked(auctionService.placeBid)
        .mockResolvedValue({ accepted: true });
      const client = { emit: jest.fn() };
      await gateway.handlePlaceBid(client as never, {
        auctionId: 'a1',
        userId: 'u1',
        amount: 150,
      });
      expect(auctionService.placeBid).toHaveBeenCalledWith('a1', 'u1', 150);
      expect(client.emit).toHaveBeenCalledWith('bid_result', {
        accepted: true,
      });
    });

    it('emits bid_result with error when payload incomplete', async () => {
      const client = { emit: jest.fn() };
      await gateway.handlePlaceBid(client as never, {} as never);
      expect(client.emit).toHaveBeenCalledWith('bid_result', {
        accepted: false,
        reason: 'auctionId, userId, amount required',
      });
    });
  });
});
