import { Module } from '@nestjs/common';
import { AuctionController } from './auction.controller';
import { AuctionGateway } from './auction.gateway';
import { AuctionService } from './auction.service';
import { AuctionPersistenceService } from './auction-persistence.service';

@Module({
  controllers: [AuctionController],
  providers: [AuctionService, AuctionGateway, AuctionPersistenceService],
  exports: [AuctionService],
})
export class AuctionModule {}
