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

interface ChatComment {
  id: string;
  auctionId: string;
  userId: string;
  displayName: string;
  text: string;
  createdAt: number;
}

interface SendCommentPayload {
  auctionId: string;
  userId: string;
  displayName: string;
  text: string;
}

const MAX_COMMENT_LENGTH = 180;
const MAX_COMMENTS_PER_AUCTION = 100;
const COMMENT_RATE_LIMIT_MS = 800;

@WebSocketGateway({ cors: { origin: '*' } })
export class AuctionGateway implements OnModuleInit {
  @WebSocketServer()
  server!: Server;

  private readonly commentsByAuction = new Map<string, ChatComment[]>();
  private readonly lastCommentAtByUser = new Map<string, number>();

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
    client.emit(
      'comments_snapshot',
      this.commentsByAuction.get(auctionId) ?? [],
    );
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

  @SubscribeMessage('send_comment')
  handleSendComment(
    client: { emit: (event: string, payload: unknown) => void },
    payload: SendCommentPayload,
  ): void {
    const auctionId = payload?.auctionId?.trim();
    const userId = payload?.userId?.trim();
    const displayName = payload?.displayName?.trim();
    const text = payload?.text?.trim();

    if (!auctionId || !userId || !displayName || !text) {
      client.emit('comment_rejected', {
        reason: 'auctionId, userId, displayName, text required',
      });
      return;
    }

    if (text.length > MAX_COMMENT_LENGTH) {
      client.emit('comment_rejected', {
        reason: `Comment too long (${MAX_COMMENT_LENGTH} max)`,
      });
      return;
    }

    const userAuctionKey = `${auctionId}:${userId}`;
    const now = Date.now();
    const lastCommentAt = this.lastCommentAtByUser.get(userAuctionKey) ?? 0;

    if (now - lastCommentAt < COMMENT_RATE_LIMIT_MS) {
      client.emit('comment_rejected', {
        reason: 'You are commenting too fast',
      });
      return;
    }
    this.lastCommentAtByUser.set(userAuctionKey, now);

    const comment: ChatComment = {
      id: `${now}-${Math.round(Math.random() * 1_000_000)}`,
      auctionId,
      userId,
      displayName,
      text,
      createdAt: now,
    };

    const comments = this.commentsByAuction.get(auctionId) ?? [];
    comments.push(comment);
    if (comments.length > MAX_COMMENTS_PER_AUCTION) {
      comments.splice(0, comments.length - MAX_COMMENTS_PER_AUCTION);
    }
    this.commentsByAuction.set(auctionId, comments);

    this.server
      .to(this.auctionService.getRoomName(auctionId))
      .emit('comment_added', comment);
  }
}
