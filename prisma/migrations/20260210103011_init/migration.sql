-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('CREATED', 'LIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('PENDING', 'LIVE', 'SOLD', 'UNSOLD');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "displayName" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" UUID NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'CREATED',
    "currentItemIndex" INTEGER NOT NULL DEFAULT 0,
    "maxDurationSec" INTEGER NOT NULL DEFAULT 300,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "sellerId" UUID NOT NULL,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionItem" (
    "id" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "itemOrder" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "startingPrice" INTEGER NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 60,
    "extraDurationSec" INTEGER NOT NULL DEFAULT 15,
    "status" "ItemStatus" NOT NULL DEFAULT 'PENDING',
    "highestBid" INTEGER NOT NULL DEFAULT 0,
    "extended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldAt" TIMESTAMP(3),
    "highestBidderId" UUID,

    CONSTRAINT "AuctionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemResult" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "finalPrice" INTEGER NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "winnerId" UUID,

    CONSTRAINT "ItemResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_displayName_key" ON "User"("displayName");

-- CreateIndex
CREATE INDEX "Auction_status_createdAt_idx" ON "Auction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuctionItem_auctionId_itemOrder_idx" ON "AuctionItem"("auctionId", "itemOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionItem_auctionId_itemOrder_key" ON "AuctionItem"("auctionId", "itemOrder");

-- CreateIndex
CREATE INDEX "Bid_auctionId_itemId_createdAt_idx" ON "Bid"("auctionId", "itemId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ItemResult_itemId_key" ON "ItemResult"("itemId");

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionItem" ADD CONSTRAINT "AuctionItem_highestBidderId_fkey" FOREIGN KEY ("highestBidderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionItem" ADD CONSTRAINT "AuctionItem_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AuctionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemResult" ADD CONSTRAINT "ItemResult_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemResult" ADD CONSTRAINT "ItemResult_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AuctionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
