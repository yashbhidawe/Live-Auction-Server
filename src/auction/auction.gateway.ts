import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { OnModuleInit } from '@nestjs/common';
import { Server } from 'socket.io';
import {
  AuctionService,
  type AuctionStateChangeEvent,
} from './auction.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class AuctionGateway implements OnModuleInit {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly auctionService: AuctionService) {}

  onModuleInit(): void {
    this.auctionService
      .getEventEmitter()
      .on('stateChange', (data: AuctionStateChangeEvent) => {
        const room = this.auctionService.getRoomName(data.auctionId);
        if (data.event === 'auction_state') {
          this.server.to(room).emit('auction_state', data.state);
        } else if (data.event === 'item_sold') {
          this.server.to(room).emit('item_sold', {
            itemId: data.itemId,
            winnerId: data.winnerId,
            finalPrice: data.finalPrice,
          });
          this.server.to(room).emit('auction_state', data.state);
        } else if (data.event === 'auction_ended') {
          this.server.to(room).emit('auction_ended', {
            auctionId: data.auctionId,
            results: data.results,
          });
          this.server.to(room).emit('auction_state', data.state);
        }
      });
  }

  @SubscribeMessage('join_auction')
  async handleJoinAuction(
    client: {
      id: string;
      join: (room: string) => void;
      emit: (event: string, payload: unknown) => void;
    },
    payload: { auctionId: string },
  ): Promise<void> {
    const { auctionId } = payload ?? {};
    if (!auctionId) {
      client.emit('error', { message: 'auctionId required' });
      return;
    }
    const room = this.auctionService.getRoomName(auctionId);
    client.join(room);
    const state = await this.auctionService.getState(auctionId);
    client.emit('auction_state', state ?? { error: 'Auction not found' });
  }

  @SubscribeMessage('leave_auction')
  handleLeaveAuction(
    client: { leave: (room: string) => void },
    payload: { auctionId: string },
  ): void {
    const { auctionId } = payload ?? {};
    if (auctionId) client.leave(this.auctionService.getRoomName(auctionId));
  }

  @SubscribeMessage('place_bid')
  async handlePlaceBid(
    client: { emit: (event: string, payload: unknown) => void },
    payload: { auctionId: string; userId: string; amount: number },
  ): Promise<void> {
    const { auctionId, userId, amount } = payload ?? {};
    if (!auctionId || userId == null || amount == null) {
      client.emit('bid_result', {
        accepted: false,
        reason: 'auctionId, userId, amount required',
      });
      return;
    }
    const result = await this.auctionService.placeBid(
      auctionId,
      userId,
      amount,
    );
    client.emit('bid_result', result);
  }
}
