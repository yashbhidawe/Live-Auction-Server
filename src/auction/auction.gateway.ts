import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger, OnModuleInit } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { Server, Socket } from 'socket.io';
import {
  AuctionService,
  type AuctionStateChangeEvent,
} from './auction.service';
import { UserService } from '../user/user.service';

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
  text: string;
}

const MAX_COMMENT_LENGTH = 180;
const MAX_COMMENTS_PER_AUCTION = 100;
const COMMENT_RATE_LIMIT_MS = 800;

interface SocketSession {
  clerkId: string;
  userId: string;
  displayName: string;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class AuctionGateway implements OnModuleInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AuctionGateway.name);
  private readonly commentsByAuction = new Map<string, ChatComment[]>();
  private readonly lastCommentAtByUser = new Map<string, number>();
  private readonly sessionBySocketId = new Map<string, SocketSession>();

  constructor(
    private readonly auctionService: AuctionService,
    private readonly userService: UserService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!token || !secretKey) {
      client.emit('auth_error', { message: 'Authentication required' });
      client.disconnect(true);
      return;
    }

    try {
      const verification = await verifyToken(token, { secretKey });
      if (verification.errors) {
        client.emit('auth_error', {
          message: verification.errors[0]?.message ?? 'Token verification failed',
        });
        client.disconnect(true);
        return;
      }

      const payload =
        (verification as any).sub || (verification as any).userId
          ? verification
          : (verification as any).data;
      const clerkId = (payload as any)?.sub || (payload as any)?.userId;
      if (!clerkId) {
        client.emit('auth_error', { message: 'Invalid token payload' });
        client.disconnect(true);
        return;
      }

      const user = await this.userService.syncFromClerk(clerkId);
      this.sessionBySocketId.set(client.id, {
        clerkId,
        userId: user.id,
        displayName: user.displayName,
      });
      this.logger.debug(`Socket authenticated id=${client.id} clerk=${clerkId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Socket auth failed: ${msg}`);
      client.emit('auth_error', { message: 'Authentication failed' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.sessionBySocketId.delete(client.id);
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const header = client.handshake.headers?.authorization;
    const authHeader = Array.isArray(header) ? header[0] : header;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    return token || null;
  }

  private requireSession(client: Socket): SocketSession | null {
    const session = this.sessionBySocketId.get(client.id) ?? null;
    if (!session) {
      client.emit('auth_error', { message: 'Authentication required' });
      client.disconnect(true);
      return null;
    }
    return session;
  }

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
    client: Socket,
    payload: { auctionId: string },
  ): Promise<void> {
    if (!this.requireSession(client)) return;

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
    client: Socket,
    payload: { auctionId: string },
  ): void {
    if (!this.requireSession(client)) return;

    const { auctionId } = payload ?? {};
    if (auctionId) client.leave(this.auctionService.getRoomName(auctionId));
  }

  @SubscribeMessage('place_bid')
  async handlePlaceBid(
    client: Socket,
    payload: { auctionId: string; amount: number; idempotencyKey?: string },
  ): Promise<void> {
    const session = this.requireSession(client);
    if (!session) return;

    const { auctionId, amount } = payload ?? {};
    if (!auctionId || amount == null) {
      client.emit('bid_result', {
        accepted: false,
        reason: 'auctionId, amount required',
      });
      return;
    }
    const result = await this.auctionService.placeBid(
      auctionId,
      session.userId,
      amount,
      payload?.idempotencyKey,
    );
    client.emit('bid_result', result);
  }

  @SubscribeMessage('send_comment')
  handleSendComment(
    client: Socket,
    payload: SendCommentPayload,
  ): void {
    const session = this.requireSession(client);
    if (!session) return;

    const auctionId = payload?.auctionId?.trim();
    const text = payload?.text?.trim();

    if (!auctionId || !text) {
      client.emit('comment_rejected', {
        reason: 'auctionId, text required',
      });
      return;
    }

    if (text.length > MAX_COMMENT_LENGTH) {
      client.emit('comment_rejected', {
        reason: `Comment too long (${MAX_COMMENT_LENGTH} max)`,
      });
      return;
    }

    const userAuctionKey = `${auctionId}:${session.userId}`;
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
      userId: session.userId,
      displayName: session.displayName,
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
