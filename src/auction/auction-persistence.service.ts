import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuctionState, AuctionItem as EngineItem } from './engine';
import {
  AuctionStatus as PrismaAuctionStatus,
  ItemStatus as PrismaItemStatus,
} from '@prisma/client';

/** Lightweight summary for listing auctions */
export interface AuctionSummary {
  id: string;
  sellerId: string;
  status: string;
  createdAt: Date;
  sellerName: string;
  firstItemName: string | null;
  itemCount: number;
}

@Injectable()
export class AuctionPersistenceService {
  private readonly logger = new Logger(AuctionPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /* ------------------------------------------------------------------ */
  /*  WRITES                                                             */
  /* ------------------------------------------------------------------ */

  /** Persist a newly created auction + its items */
  async persistAuction(state: AuctionState): Promise<void> {
    await this.prisma.auction.create({
      data: {
        id: state.id,
        status: state.status as PrismaAuctionStatus,
        currentItemIndex: state.currentItemIndex,
        maxDurationSec: state.maxDurationSec,
        sellerId: state.sellerId,
        items: {
          create: state.items.map((item, idx) => ({
            id: item.id,
            itemOrder: idx,
            name: item.name,
            startingPrice: item.startingPrice,
            durationSec: item.durationSec,
            extraDurationSec: item.extraDurationSec,
            status: item.status as PrismaItemStatus,
            highestBid: item.highestBid,
            extended: item.extended,
            highestBidderId: item.highestBidderId,
          })),
        },
      },
    });
  }

  /** Persist auction status change (e.g. CREATED -> LIVE) */
  async persistAuctionStatus(
    auctionId: string,
    status: string,
    extra?: { startedAt?: Date; endedAt?: Date; currentItemIndex?: number },
  ): Promise<void> {
    await this.prisma.auction.update({
      where: { id: auctionId },
      data: {
        status: status as PrismaAuctionStatus,
        ...(extra?.startedAt && { startedAt: extra.startedAt }),
        ...(extra?.endedAt && { endedAt: extra.endedAt }),
        ...(extra?.currentItemIndex !== undefined && {
          currentItemIndex: extra.currentItemIndex,
        }),
      },
    });
  }

  /** Persist item status change (e.g. PENDING -> LIVE) */
  async persistItemStatus(
    itemId: string,
    status: string,
    extra?: {
      highestBid?: number;
      highestBidderId?: string | null;
      extended?: boolean;
      soldAt?: Date;
    },
  ): Promise<void> {
    await this.prisma.auctionItem.update({
      where: { id: itemId },
      data: {
        status: status as PrismaItemStatus,
        ...(extra?.highestBid !== undefined && {
          highestBid: extra.highestBid,
        }),
        ...(extra?.highestBidderId !== undefined && {
          highestBidderId: extra.highestBidderId,
        }),
        ...(extra?.extended !== undefined && { extended: extra.extended }),
        ...(extra?.soldAt && { soldAt: extra.soldAt }),
      },
    });
  }

  /** Persist an accepted bid */
  async persistBid(
    auctionId: string,
    itemId: string,
    bidderId: string,
    amount: number,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.bid.create({
        data: { auctionId, itemId, bidderId, amount },
      }),
      this.prisma.auctionItem.update({
        where: { id: itemId },
        data: { highestBid: amount, highestBidderId: bidderId },
      }),
    ]);
  }

  /** Persist the result of an item sale (or UNSOLD when no winner). */
  async persistItemResult(
    itemId: string,
    winnerId: string | null,
    finalPrice: number,
  ): Promise<void> {
    const now = new Date();
    const sold = winnerId != null;
    await this.prisma.$transaction([
      this.prisma.auctionItem.update({
        where: { id: itemId },
        data: {
          status: sold ? 'SOLD' : 'UNSOLD',
          highestBid: finalPrice,
          highestBidderId: winnerId,
          soldAt: sold ? now : null,
        },
      }),
      // Only create ItemResult if there's a winner
      ...(winnerId
        ? [
            this.prisma.itemResult.create({
              data: { itemId, winnerId, finalPrice, soldAt: now },
            }),
          ]
        : []),
    ]);
  }

  /** Persist full auction end */
  async persistAuctionEnd(
    auctionId: string,
    results: Array<{
      itemId: string;
      winnerId: string | null;
      finalPrice: number;
    }>,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.auction.update({
        where: { id: auctionId },
        data: { status: 'ENDED', endedAt: now },
      }),
      ...results
        .filter((r) => r.winnerId)
        .map((r) =>
          this.prisma.itemResult.upsert({
            where: { itemId: r.itemId },
            create: {
              itemId: r.itemId,
              winnerId: r.winnerId,
              finalPrice: r.finalPrice,
              soldAt: now,
            },
            update: {
              winnerId: r.winnerId,
              finalPrice: r.finalPrice,
            },
          }),
        ),
    ]);
  }

  /** Persist item extension */
  async persistItemExtension(itemId: string): Promise<void> {
    await this.prisma.auctionItem.update({
      where: { id: itemId },
      data: { extended: true },
    });
  }

  /** Update currentItemIndex in DB */
  async persistCurrentItemIndex(
    auctionId: string,
    index: number,
  ): Promise<void> {
    await this.prisma.auction.update({
      where: { id: auctionId },
      data: { currentItemIndex: index },
    });
  }

  /* ------------------------------------------------------------------ */
  /*  READS                                                              */
  /* ------------------------------------------------------------------ */

  /** Load all non-ENDED auctions, reconstructing engine-compatible state */
  async loadActiveAuctions(): Promise<AuctionState[]> {
    const auctions = await this.prisma.auction.findMany({
      where: { status: { not: 'ENDED' } },
      include: {
        items: { orderBy: { itemOrder: 'asc' } },
      },
    });

    return auctions.map((a) => this.toEngineState(a));
  }

  /** Load a single auction by ID (for ended auctions / fallback) */
  async loadAuction(auctionId: string): Promise<AuctionState | null> {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      include: {
        items: { orderBy: { itemOrder: 'asc' } },
      },
    });
    if (!auction) return null;
    return this.toEngineState(auction);
  }

  /** List all auctions (lightweight, includes seller display name) */
  async listAuctions(): Promise<AuctionSummary[]> {
    const auctions = await this.prisma.auction.findMany({
      select: {
        id: true,
        sellerId: true,
        status: true,
        createdAt: true,
        seller: { select: { displayName: true } },
        items: {
          select: { name: true },
          orderBy: { itemOrder: 'asc' },
          take: 1,
        },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return auctions.map((a) => ({
      id: a.id,
      sellerId: a.sellerId,
      status: a.status,
      createdAt: a.createdAt,
      sellerName: a.seller.displayName,
      firstItemName: a.items[0]?.name ?? null,
      itemCount: a._count.items,
    }));
  }

  /** Check if a user (seller) exists */
  async validateSellerExists(sellerId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { id: true },
    });
    return user !== null;
  }

  /* ------------------------------------------------------------------ */
  /*  HELPERS                                                            */
  /* ------------------------------------------------------------------ */

  /** Convert a Prisma auction + items row into engine-compatible AuctionState */
  private toEngineState(auction: {
    id: string;
    sellerId: string;
    status: string;
    currentItemIndex: number;
    maxDurationSec: number;
    items: Array<{
      id: string;
      name: string;
      startingPrice: number;
      durationSec: number;
      extraDurationSec: number;
      status: string;
      highestBid: number;
      highestBidderId: string | null;
      extended: boolean;
    }>;
  }): AuctionState {
    const items: EngineItem[] = auction.items.map((item) => ({
      id: item.id,
      name: item.name,
      startingPrice: item.startingPrice,
      durationSec: item.durationSec,
      extraDurationSec: item.extraDurationSec,
      status: item.status as EngineItem['status'],
      highestBid: item.highestBid,
      highestBidderId: item.highestBidderId,
      extended: item.extended,
    }));

    return {
      id: auction.id,
      sellerId: auction.sellerId,
      status: auction.status as AuctionState['status'],
      items,
      currentItemIndex: auction.currentItemIndex,
      maxDurationSec: auction.maxDurationSec,
    };
  }
}
