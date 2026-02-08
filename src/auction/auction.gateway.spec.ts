import { Test, TestingModule } from '@nestjs/testing';
import { AuctionGateway } from './auction.gateway';
import { AuctionService } from './auction.service';

describe('AuctionGateway', () => {
  let gateway: AuctionGateway;
  let auctionService: AuctionService;
  let mockServer: { emit: jest.Mock };

  beforeEach(async () => {
    mockServer = { emit: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuctionGateway,
        {
          provide: AuctionService,
          useValue: {
            getState: jest
              .fn()
              .mockReturnValue({ status: 'LIVE', highestBid: 100 }),
            placeBid: jest.fn(),
          },
        },
      ],
    }).compile();

    gateway = module.get(AuctionGateway);
    auctionService = module.get(AuctionService);
    (gateway as unknown as { server: typeof mockServer }).server = mockServer;
  });

  describe('handleConnection', () => {
    it('emits auction_state with engine.getState()', () => {
      gateway.handleConnection();
      expect(auctionService.getState).toHaveBeenCalledTimes(1);
      expect(mockServer.emit).toHaveBeenCalledWith('auction_state', {
        status: 'LIVE',
        highestBid: 100,
      });
    });
  });

  describe('handlePlaceBid', () => {
    it('calls engine.placeBid and emits bid_result to sender', () => {
      jest.mocked(auctionService.placeBid).mockReturnValue({ accepted: true });
      const client = { emit: jest.fn() };
      gateway.handlePlaceBid(client as never, { userId: 'u1', amount: 150 });
      expect(auctionService.placeBid).toHaveBeenCalledWith('u1', 150);
      expect(client.emit).toHaveBeenCalledWith('bid_result', {
        accepted: true,
      });
    });

    it('broadcasts auction_state when bid accepted', () => {
      jest.mocked(auctionService.placeBid).mockReturnValue({ accepted: true });
      jest
        .mocked(auctionService.getState)
        .mockReturnValue({ status: 'LIVE', highestBid: 150 });
      const client = { emit: jest.fn() };
      gateway.handlePlaceBid(client as never, { userId: 'u1', amount: 150 });
      expect(mockServer.emit).toHaveBeenCalledWith('auction_state', {
        status: 'LIVE',
        highestBid: 150,
      });
    });

    it('does not broadcast when bid rejected', () => {
      jest.mocked(auctionService.placeBid).mockReturnValue({
        accepted: false,
        reason: 'Bid must be higher',
      });
      const client = { emit: jest.fn() };
      gateway.handlePlaceBid(client as never, { userId: 'u1', amount: 50 });
      expect(client.emit).toHaveBeenCalledWith('bid_result', {
        accepted: false,
        reason: 'Bid must be higher',
      });
      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });
});
