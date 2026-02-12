import { Test, TestingModule } from '@nestjs/testing';
import { AuctionGateway } from './auction.gateway';
import { AuctionService } from './auction.service';
import { UserService } from '../user/user.service';

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
        {
          provide: UserService,
          useValue: {
            syncFromClerk: jest
              .fn()
              .mockResolvedValue({ id: 'u1', displayName: 'User 1' }),
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
      const client = { id: 'c1', join: jest.fn(), emit: jest.fn() };
      (
        gateway as unknown as {
          sessionBySocketId: Map<
            string,
            { clerkId: string; userId: string; displayName: string }
          >;
        }
      ).sessionBySocketId.set('c1', {
        clerkId: 'clerk_1',
        userId: 'u1',
        displayName: 'User 1',
      });
      await gateway.handleJoinAuction(client as never, { auctionId: 'a1' });
      expect(client.join).toHaveBeenCalledWith('auction:a1');
      expect(client.emit).toHaveBeenCalledWith('auction_state', state);
    });

    it('emits error when auctionId missing', async () => {
      const client = { id: 'c2', join: jest.fn(), emit: jest.fn() };
      (
        gateway as unknown as {
          sessionBySocketId: Map<
            string,
            { clerkId: string; userId: string; displayName: string }
          >;
        }
      ).sessionBySocketId.set('c2', {
        clerkId: 'clerk_1',
        userId: 'u1',
        displayName: 'User 1',
      });
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
      const client = { id: 'c3', leave: jest.fn(), emit: jest.fn() };
      (
        gateway as unknown as {
          sessionBySocketId: Map<
            string,
            { clerkId: string; userId: string; displayName: string }
          >;
        }
      ).sessionBySocketId.set('c3', {
        clerkId: 'clerk_1',
        userId: 'u1',
        displayName: 'User 1',
      });
      gateway.handleLeaveAuction(client as never, { auctionId: 'a1' });
      expect(client.leave).toHaveBeenCalledWith('auction:a1');
    });
  });

  describe('handlePlaceBid', () => {
    it('calls service.placeBid with authenticated user and emits bid_result', async () => {
      jest
        .mocked(auctionService.placeBid)
        .mockResolvedValue({ accepted: true });
      const client = {
        id: 'c4',
        emit: jest.fn(),
        disconnect: jest.fn(),
      };
      (
        gateway as unknown as {
          sessionBySocketId: Map<
            string,
            { clerkId: string; userId: string; displayName: string }
          >;
        }
      ).sessionBySocketId.set('c4', {
        clerkId: 'clerk_1',
        userId: 'u1',
        displayName: 'User 1',
      });
      await gateway.handlePlaceBid(client as never, {
        auctionId: 'a1',
        amount: 150,
      });
      expect(auctionService.placeBid).toHaveBeenCalledWith('a1', 'u1', 150);
      expect(client.emit).toHaveBeenCalledWith('bid_result', {
        accepted: true,
      });
    });

    it('emits bid_result with error when payload incomplete', async () => {
      const client = {
        id: 'c5',
        emit: jest.fn(),
        disconnect: jest.fn(),
      };
      (
        gateway as unknown as {
          sessionBySocketId: Map<
            string,
            { clerkId: string; userId: string; displayName: string }
          >;
        }
      ).sessionBySocketId.set('c5', {
        clerkId: 'clerk_1',
        userId: 'u1',
        displayName: 'User 1',
      });
      await gateway.handlePlaceBid(client as never, {} as never);
      expect(client.emit).toHaveBeenCalledWith('bid_result', {
        accepted: false,
        reason: 'auctionId, amount required',
      });
    });
  });
});
