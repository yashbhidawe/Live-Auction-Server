import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { AuctionService } from './auction.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class AuctionGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly auctionService: AuctionService) {}

  handleConnection(): void {
    this.server.emit('auction_state', this.auctionService.getState());
  }

  @SubscribeMessage('place_bid')
  handlePlaceBid(
    _client: { emit: (event: string, payload: unknown) => void },
    payload: { userId: string; amount: number },
  ): void {
    const result = this.auctionService.placeBid(payload.userId, payload.amount);
    _client.emit('bid_result', result);
    if (result.accepted) {
      this.server.emit('auction_state', this.auctionService.getState());
    }
  }
}
