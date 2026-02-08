import { Module } from '@nestjs/common';
import { AuctionController } from './auction.controller';
import { AuctionGateway } from './auction.gateway';
import { AuctionService } from './auction.service';

@Module({
  controllers: [AuctionController],
  providers: [AuctionService, AuctionGateway],
  exports: [AuctionService],
})
export class AuctionModule {}
