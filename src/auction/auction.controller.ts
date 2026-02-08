import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuctionService } from './auction.service';

@Controller('auctions')
export class AuctionController {
  constructor(private readonly auctionService: AuctionService) {}

  @Get('state')
  getState() {
    return this.auctionService.getState();
  }

  @Post('start')
  start(@Body('startingPrice') startingPrice: number) {
    return this.auctionService.startAuction(startingPrice ?? 100);
  }
}
